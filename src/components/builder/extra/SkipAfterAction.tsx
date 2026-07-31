import { ReadOnlyActionChip } from './ReadOnlyActionChip';
import type { ExtraActionProps } from './types';

export function SkipAfterAction({ action }: ExtraActionProps) {
  return <ReadOnlyActionChip action={action} />;
}
