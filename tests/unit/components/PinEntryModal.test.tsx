/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
import { PinEntryModal } from '@/components/library/PinEntryModal'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'

describe('PinEntryModal (Integrated Stack)', () => {
  let db: BetterSQLiteService
  let closeCount: number
  let successCount: number

  beforeEach(async () => {
    db = await setupTestDb()
    Object.assign(window, { electronAPI: setupRealIntegratedBridge().api })
    closeCount = 0
    successCount = 0
  })

  afterEach(() => {
    cleanup()
    cleanupTestDb()
  })

  const renderModal = (isOpen = true) => render(
    <PinEntryModal
      isOpen={isOpen}
      onClose={() => { closeCount += 1 }}
      onSuccess={() => { successCount += 1 }}
    />
  )

  const enterPin = (pin: string) => fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: pin } })

  it('does not render while closed', () => {
    const { container } = renderModal(false)
    expect(container.firstChild).toBeNull()
  })

  it('shows PIN creation when the database has no PIN', async () => {
    renderModal()
    expect(await screen.findByText('Set Security PIN')).toBeTruthy()
    expect(screen.getByText('Create a PIN to protect your secret libraries and personal content.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save PIN/i })).toBeTruthy()
  })

  it('shows unlock mode when a PIN exists in the database', async () => {
    await db.config.setPin('5678')
    renderModal()
    expect(await screen.findByText('Unlock Library')).toBeTruthy()
    expect(screen.getByText('Enter your security PIN to view protected libraries.')).toBeTruthy()
  })

  it('filters non-numeric input and requires four digits', async () => {
    await db.config.setPin('5678')
    renderModal()
    const input = await screen.findByPlaceholderText('••••') as HTMLInputElement
    const submit = screen.getByRole('button', { name: /Unlock/i }) as HTMLButtonElement

    expect(submit.disabled).toBe(true)
    enterPin('12abc3')
    expect(input.value).toBe('123')
    expect(submit.disabled).toBe(true)
    enterPin('1234')
    expect(input.value).toBe('1234')
    expect(submit.disabled).toBe(false)
  })

  it('sets a first-time PIN through the real database handler', async () => {
    renderModal()
    await screen.findByText('Set Security PIN')
    enterPin('1234')
    fireEvent.click(screen.getByRole('button', { name: /Save PIN/i }))

    await waitFor(async () => expect(await db.config.hasPin()).toBe(true))
    expect(await db.config.verifyPin('1234')).toBe(true)
    expect(successCount).toBe(1)
  })

  it('unlocks with a valid PIN and rejects an invalid one', async () => {
    await db.config.setPin('5678')
    renderModal()
    await screen.findByText('Unlock Library')

    enterPin('0000')
    fireEvent.click(screen.getByRole('button', { name: /Unlock/i }))
    expect(await screen.findByText('Invalid PIN. Please try again.')).toBeTruthy()
    expect((screen.getByPlaceholderText('••••') as HTMLInputElement).value).toBe('')
    expect(successCount).toBe(0)

    enterPin('5678')
    fireEvent.click(screen.getByRole('button', { name: /Unlock/i }))
    await waitFor(() => expect(successCount).toBe(1))
    expect(await db.config.verifyPin('5678')).toBe(true)
  })

  it('calls the close handler when the close button is clicked', async () => {
    await db.config.setPin('5678')
    renderModal()
    await screen.findByText('Unlock Library')
    fireEvent.click(screen.getByRole('button', { name: '' }))
    expect(closeCount).toBe(1)
  })
})
