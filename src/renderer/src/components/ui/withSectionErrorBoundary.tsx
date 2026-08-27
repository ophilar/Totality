import type { ComponentProps, ComponentType } from 'react'
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary'

export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  section: string,
  options?: Omit<ComponentProps<typeof SectionErrorBoundary>, 'children' | 'section'>,
) {
  return function WithErrorBoundary(props: P) {
    return (
      <SectionErrorBoundary section={section} {...options}>
        <WrappedComponent {...props} />
      </SectionErrorBoundary>
    )
  }
}
