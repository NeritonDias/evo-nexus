import {
  Bot,
  Brain,
  FolderKanban,
  DollarSign,
  Heart,
  GraduationCap,
  Target,
  Camera,
  Users,
  Compass,
  BookOpen,
  Megaphone,
  UserCheck,
  Headphones,
  Scale,
  Lightbulb,
  BarChart3,
  Navigation,
  History,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface AgentMeta {
  icon: LucideIcon
  color: string
  command: string
  label: string
}

const AGENT_META: Record<string, AgentMeta> = {
  'atlas-project': { icon: FolderKanban, color: '#60A5FA', command: '/atlas-project', label: 'Projects' },
  'clawdia-assistant': { icon: Brain, color: '#22D3EE', command: '/clawdia', label: 'Operations' },
  'flux-finance': { icon: DollarSign, color: '#34D399', command: '/flux', label: 'Finance' },
  'kai-personal-assistant': { icon: Heart, color: '#F472B6', command: '/kai', label: 'Personal' },
  'mentor-courses': { icon: GraduationCap, color: '#FBBF24', command: '/mentor', label: 'Courses' },
  'lumen-learning': { icon: Zap, color: '#FCD34D', command: '/lumen-learning', label: 'Learning Retention' },
  'nex-sales': { icon: Target, color: '#FB923C', command: '/nex', label: 'Sales' },
  'pixel-social-media': { icon: Camera, color: '#A78BFA', command: '/pixel', label: 'Social Media' },
  'pulse-community': { icon: Users, color: '#2DD4BF', command: '/pulse', label: 'Community' },
  'sage-strategy': { icon: Compass, color: '#818CF8', command: '/sage', label: 'Strategy' },
  oracle: { icon: BookOpen, color: '#F59E0B', command: '/oracle', label: 'Knowledge' },
  'mako-marketing': { icon: Megaphone, color: '#FB923C', command: '/mako', label: 'Marketing' },
  'aria-hr': { icon: UserCheck, color: '#F472B6', command: '/aria', label: 'HR / People' },
  'zara-cs': { icon: Headphones, color: '#22D3EE', command: '/zara', label: 'Customer Success' },
  'lex-legal': { icon: Scale, color: '#C084FC', command: '/lex', label: 'Legal' },
  'nova-product': { icon: Lightbulb, color: '#60A5FA', command: '/nova', label: 'Product' },
  'dex-data': { icon: BarChart3, color: '#FBBF24', command: '/dex', label: 'Data / BI' },
  'helm-conductor': { icon: Navigation, color: '#14B8A6', command: '/helm-conductor', label: 'Cycle Orchestration' },
  'mirror-retro': { icon: History, color: '#94A3B8', command: '/mirror-retro', label: 'Retrospective' },
}

const DEFAULT_META: AgentMeta = {
  icon: Bot,
  color: '#00FFA7',
  command: '',
  label: 'Agent',
}

export function getAgentMeta(name: string): AgentMeta {
  const base = AGENT_META[name] || DEFAULT_META
  // Always derive command from the slug so custom agents work too
  return { ...base, command: AGENT_META[name]?.command || `/${name}` }
}
