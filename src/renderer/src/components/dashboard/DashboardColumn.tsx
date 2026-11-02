import React from 'react'

interface DashboardColumnProps {
  icon: React.ReactNode
  title: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function DashboardColumn({
  icon,
  title,
  headerExtra,
  children,
  className = ''
}: DashboardColumnProps) {
  return (
    <div className={`flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden ${className}`}>
      <div className="shrink-0 p-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{icon}</div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
        </div>
        {headerExtra}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
        {children}
      </div>
    </div>
  )
}
