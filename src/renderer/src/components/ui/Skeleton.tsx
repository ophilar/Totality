import { HTMLAttributes } from 'react'

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted/50 ${className}`}
      {...props}
    />
  )
}

export function MediaCardSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="media-card-skeleton">
      <Skeleton className="aspect-2/3 w-full rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

export function DashboardRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-border/10">
      <Skeleton className="w-12 h-16 shrink-0 rounded" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="w-16 h-6 rounded-full" />
    </div>
  )
}
