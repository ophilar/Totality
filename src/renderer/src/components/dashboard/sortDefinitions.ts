export interface DashboardSortOption {
  key: string
  label: string
}

export const dashboardSortOptions = {
  upgrades: [
    { key: 'quality', label: 'Quality' },
    { key: 'efficiency', label: 'Efficiency' },
    { key: 'recent', label: 'Recent' },
    { key: 'title', label: 'Title' },
  ],
  collections: [
    { key: 'completeness', label: 'Completeness' },
    { key: 'name', label: 'Name' },
    { key: 'recent', label: 'Recent' },
  ],
  series: [
    { key: 'completeness', label: 'Completeness' },
    { key: 'name', label: 'Name' },
    { key: 'recent', label: 'Recent' },
  ],
  artists: [
    { key: 'completeness', label: 'Completeness' },
    { key: 'name', label: 'Name' },
  ],
} satisfies Record<string, DashboardSortOption[]>
