import {orderedStages, stageKeyOf} from './lead-cohorts';

/** Stages that are not in the working pipeline share one column so every lead is counted once. */
export const OTHER_STAGE = 'other';

export type EmployeeStageColumn = {
  stage: string;
  label: string;
  short: string;
};

const SHORT_LABEL: Record<string, string> = {
  new: 'جديد',
  no_answer: 'لم يرد',
  contacted: 'تواصل',
  interested: 'مهتم',
  awaiting_offers: 'عروض',
  field_dispatch: 'تفويج',
  property_visited: 'زيارة',
  negotiation: 'تفاوض',
  bank_referred: 'بنك',
  debt_payoff: 'مديونية',
  deposit_paid: 'عربون',
  contract_signed: 'عقد',
  transferred: 'إفراغ',
  postponed: 'مؤجل',
  unqualified: 'غير مؤهل',
  not_interested: 'غير مهتم',
  closed: 'مغلق',
  other: 'أخرى',
};

export function employeeStageColumns(): EmployeeStageColumn[] {
  const columns = orderedStages().map(stage => ({
    stage: stage.stage,
    label: stage.label,
    short: SHORT_LABEL[stage.stage] || stage.label,
  }));
  columns.push({stage: OTHER_STAGE, label: 'أخرى', short: 'أخرى'});
  return columns;
}

export function emptyStageCounts(columns = employeeStageColumns()): Record<string, number> {
  return Object.fromEntries(columns.map(column => [column.stage, 0]));
}

export function bucketStage(stage: unknown, columns = employeeStageColumns()): string {
  const key = stageKeyOf(stage) || 'new';
  return columns.some(column => column.stage === key) ? key : OTHER_STAGE;
}

export function addStageCount(counts: Record<string, number>, stage: unknown, columns = employeeStageColumns()) {
  const key = bucketStage(stage, columns);
  counts[key] = (Number(counts[key]) || 0) + 1;
}

/** One assigned lead: the employee total and exactly one current-stage column both move. */
export function noteEmployeeLead(stat: {assigned: number; stages: Record<string, number>}, stage: unknown) {
  stat.assigned += 1;
  addStageCount(stat.stages, stage);
}

export type StageCountRow = {total: number; stages: Record<string, number>};

export function stageRowSum(row: StageCountRow, columns = employeeStageColumns()): number {
  return columns.reduce((sum, column) => sum + (Number(row.stages[column.stage]) || 0), 0);
}

export function sumStageTable(rows: StageCountRow[], columns = employeeStageColumns()): StageCountRow {
  const stages = emptyStageCounts(columns);
  for (const row of rows) {
    for (const column of columns) stages[column.stage] += Number(row.stages[column.stage]) || 0;
  }
  return {stages, total: rows.reduce((sum, row) => sum + row.total, 0)};
}

/** Each row's stages equal that employee's leads, and the footer equals those leads overall. */
export function stageTableIsExact(rows: StageCountRow[], overall?: number, columns = employeeStageColumns()): boolean {
  if (rows.some(row => stageRowSum(row, columns) !== row.total)) return false;
  const footer = sumStageTable(rows, columns);
  if (stageRowSum(footer, columns) !== footer.total) return false;
  if (overall !== undefined && footer.total !== overall) return false;
  return true;
}
