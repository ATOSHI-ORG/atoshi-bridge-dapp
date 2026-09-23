type Translate = (key: string) => string;

const REJECTION_CODES = new Set<unknown>([ 4001, '4001', 5000, '5000', 'ACTION_REJECTED' ]);
const REJECTION_MESSAGE = /(?:user (?:rejected|denied)|request (?:was )?rejected|rejected (?:the )?(?:request|transaction)|denied transaction signature)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Wallet libraries often wrap the original provider error several causes deep. */
export function isUserRejectedTransaction(error: unknown): boolean {
  const pending = [ error ];
  const visited = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || current === null || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === 'string') {
      if (REJECTION_MESSAGE.test(current)) return true;
      continue;
    }
    if (!isObject(current)) continue;

    if (REJECTION_CODES.has(current.code)) return true;
    if (current.name === 'UserRejectedRequestError') return true;

    for (const field of [ 'message', 'shortMessage', 'details' ] as const) {
      if (typeof current[field] === 'string' && REJECTION_MESSAGE.test(current[field])) return true;
    }

    pending.push(current.cause, current.error);
    if (isObject(current.data)) pending.push(current.data.originalError);
  }

  return false;
}

export function getTransactionErrorMessage(error: unknown, t: Translate): string {
  if (isUserRejectedTransaction(error)) return t('err.user_rejected');
  if (isObject(error) && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') return error;
  return t('err.unknown_transaction_error');
}
