/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { WishlistProvider } from '@/contexts/WishlistContext'
import type { ChatMessage as ChatMessageType, ActionableItem } from '@/hooks/useChat'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'

describe('ChatMessage Component', () => {
  let db: BetterSQLiteService

  beforeEach(async () => {
    db = await setupTestDb()
    Object.assign(window, { electronAPI: setupRealIntegratedBridge().api })
  })

  afterEach(() => {
    cleanup()
    cleanupTestDb()
  })

  function renderWithWishlist(message: ChatMessageType, activeTools: string[] = []) {
    return render(<WishlistProvider><ChatMessage message={message} activeTools={activeTools} /></WishlistProvider>)
  }

  it('renders user message with correct avatar, alignment, and styling', () => {
    const userMessage: ChatMessageType = {
      id: 'msg-1',
      role: 'user',
      content: 'Can you search for Sci-Fi movies?',
      timestamp: new Date().toISOString(),
    }

    const { container } = renderWithWishlist(userMessage)

    // Check content text
    expect(screen.getByText('Can you search for Sci-Fi movies?')).toBeDefined()

    // Check top layout container has flex-row-reverse for user
    const topElement = container.firstChild as HTMLElement
    expect(topElement.className).toContain('flex-row-reverse')

    // Check user avatar styling
    const avatar = container.querySelector('.bg-primary\\/20')
    expect(avatar).not.toBeNull()
  })

  it('renders assistant message with bot avatar and assistant alignment', () => {
    const botMessage: ChatMessageType = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Here are the Sci-Fi movies found in your library.',
      timestamp: new Date().toISOString(),
    }

    const { container } = renderWithWishlist(botMessage)

    expect(screen.getByText('Here are the Sci-Fi movies found in your library.')).toBeDefined()

    const topElement = container.firstChild as HTMLElement
    expect(topElement.className).toContain('flex-row')

    const avatar = container.querySelector('.bg-accent\\/20')
    expect(avatar).not.toBeNull()
  })

  it('renders loading state with "Thinking..." loader when no active tools are present', () => {
    const loadingMessage: ChatMessageType = {
      id: 'msg-3',
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(loadingMessage)

    expect(screen.getByText('Thinking...')).toBeDefined()
  })

  it('renders loading state with mapped tool labels and fallback when active tools are present', () => {
    const loadingMessage: ChatMessageType = {
      id: 'msg-4',
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date().toISOString(),
    }

    const activeTools = ['search_library', 'unknown_custom_tool']

    renderWithWishlist(loadingMessage, activeTools)

    expect(screen.getByText('Searching library...')).toBeDefined()
    expect(screen.getByText('unknown_custom_tool...')).toBeDefined()
  })

  it('renders toolsUsed badges with mapped labels and alignment', () => {
    const messageWithTools: ChatMessageType = {
      id: 'msg-5',
      role: 'assistant',
      content: 'Scan completed.',
      toolsUsed: ['get_media_items', 'custom_tool'],
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(messageWithTools)

    expect(screen.getByText('Querying media items')).toBeDefined()
    expect(screen.getByText('custom_tool')).toBeDefined()
  })

  it('does not render actionable items for user messages', () => {
    const userMessageWithItems: ChatMessageType = {
      id: 'msg-6',
      role: 'user',
      content: 'Add Inception',
      actionableItems: [{ title: 'Inception', year: 2010, media_type: 'movie' }],
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(userMessageWithItems)

    expect(screen.queryByText('Add to wishlist:')).toBeNull()
    expect(screen.queryByText('Inception (2010)')).toBeNull()
  })

  it('renders actionable items for assistant messages and handles adding item to wishlist', async () => {
    const item: ActionableItem = {
      title: 'Inception',
      year: 2010,
      media_type: 'movie',
    }

    const botMessageWithItems: ChatMessageType = {
      id: 'msg-7',
      role: 'assistant',
      content: 'I recommend adding this title.',
      actionableItems: [item],
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(botMessageWithItems)

    expect(screen.getByText('Add to wishlist:')).toBeDefined()
    const button = screen.getByRole('button', { name: 'Inception (2010)' })
    expect(button).toBeDefined()

    fireEvent.click(button)

    await waitFor(async () => {
      expect(await db.wishlist.getItems()).toContainEqual(expect.objectContaining({
        title: 'Inception',
        year: 2010,
        media_type: 'movie',
        reason: 'missing',
        priority: 3,
        status: 'active',
      }))
    })
  })

  it('maps "tv" media type to "season" and handles removing item when already in wishlist', async () => {
    await db.wishlist.add({
      media_type: 'season',
      title: 'Breaking Bad',
      year: 2008,
      tmdb_id: 'tmdb-1396',
      reason: 'missing',
      priority: 3,
      status: 'active',
    })

    const tvItem: ActionableItem = {
      title: 'Breaking Bad',
      year: 2008,
      tmdb_id: 'tmdb-1396',
      media_type: 'tv',
    }

    const botMessage: ChatMessageType = {
      id: 'msg-8',
      role: 'assistant',
      content: 'Here is the TV series.',
      actionableItems: [tvItem],
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(botMessage)

    const button = screen.getByRole('button', { name: 'Breaking Bad (2008)' })
    await waitFor(() => expect(button.className).toContain('text-foreground'))
    expect(button).toBeDefined()

    fireEvent.click(button)

    await waitFor(async () => expect(await db.wishlist.getItems()).toHaveLength(0))
  })

  it('matches wishlist item by title when tmdb_id is absent', async () => {
    await db.wishlist.add({
      media_type: 'movie',
      title: 'Unknown Indie Film',
      reason: 'missing',
      priority: 3,
      status: 'active',
    })

    const itemWithoutTmdb: ActionableItem = {
      title: 'Unknown Indie Film',
      media_type: 'movie',
    }

    const botMessage: ChatMessageType = {
      id: 'msg-9',
      role: 'assistant',
      content: 'Found title.',
      actionableItems: [itemWithoutTmdb],
      timestamp: new Date().toISOString(),
    }

    renderWithWishlist(botMessage)

    const button = screen.getByRole('button', { name: 'Unknown Indie Film' })
    await waitFor(() => expect(button.className).toContain('text-foreground'))
    fireEvent.click(button)

    await waitFor(async () => expect(await db.wishlist.getItems()).toHaveLength(0))
  })
})
