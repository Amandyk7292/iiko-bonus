export type EvidenceType = 'none' | 'photo' | 'video' | 'photo_video';
export type RoundStatus = 'pending' | 'in_progress' | 'overdue' | 'completed' | 'cancelled';
export interface Branch {
  id: string;
  name: string;
  city: string;
  active: boolean;
}
export interface Inspector {
  id: string;
  name: string;
  username: string;
  city: string;
  branchIds: string[];
  active: boolean;
}
export interface Credentials {
  username: string;
  password: string;
  url: string;
}
export interface TaskDraft {
  title: string;
  instructions: string;
  evidenceType: EvidenceType;
}
export interface CreateRound {
  inspectorId: string;
  branchIds: string[];
  title: string;
  date: string;
  deadline: string;
  tasks: TaskDraft[];
}
export interface RoundSummary {
  id: string;
  title: string;
  date: string;
  deadline: string;
  branchId: string;
  branchName: string;
  city: string;
  inspectorId: string;
  inspectorName: string;
  status: RoundStatus;
  completedAt: string | null;
  completedLate: boolean;
  totalTasks: number;
  completedTasks: number;
}
export interface Evidence {
  id: string;
  kind: 'photo' | 'video';
  mime: string;
  bytes: number;
  url: string;
  createdAt: string;
}
export interface RoundTask extends TaskDraft {
  id: string;
  position: number;
  completedAt: string | null;
  comment: string;
  evidence: Evidence[];
}
export interface RoundDetail extends RoundSummary {
  tasks: RoundTask[];
}
export interface RoundsData {
  success: boolean;
  branches: Branch[];
  inspectors: Inspector[];
  rounds: RoundSummary[];
}
