import { ChainRestError, restGet } from './chainRest';

export interface CosmosTxResponse {
  tx_response?: {
    code?: number | string;
    txhash?: string;
    raw_log?: string;
    height?: string;
    events?: Array<{
      type?: string;
      attributes?: Array<{ key?: string; value?: string }>;
    }>;
  };
}

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_COSMOS_TX_POLL_MS ?? 1500);
const TIMEOUT_MS = Number(import.meta.env.VITE_COSMOS_TX_TIMEOUT_MS ?? 90000);

/** Cosmos/Tendermint hashes are 32 bytes rendered without the EVM 0x prefix. */
export function isCosmosTxHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function isEvmTxHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Wait for inclusion and final Cosmos execution status. */
export async function waitForCosmosTx(hash: string): Promise<CosmosTxResponse> {
  if (!isCosmosTxHash(hash)) {
    throw new ChainRestError(`不是合法的 Cosmos 交易哈希: ${hash}`);
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await restGet<CosmosTxResponse>(
        `/cosmos/tx/v1beta1/txs/${encodeURIComponent(hash)}`,
      );
      const tx = response.tx_response;
      if (!tx) throw new ChainRestError(`Cosmos 节点返回了无效交易结果，tx: ${hash}`);

      const code = Number(tx.code ?? 0);
      if (code !== 0) {
        const detail = tx.raw_log ? `: ${tx.raw_log}` : '';
        throw new ChainRestError(`Cosmos 交易执行失败（code ${code}）${detail}，tx: ${hash}`);
      }
      return response;
    } catch (error) {
      // 交易刚广播时 REST 索引器可能暂时返回 404，继续轮询即可。
      if (!(error instanceof ChainRestError) || error.status !== 404) throw error;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new ChainRestError(`Cosmos 交易确认超时，请稍后按哈希查询: ${hash}`);
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function messageIdValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^0x[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(text)) return `0x${text.toLowerCase()}`;

  const bytes = decodeBase64(text);
  if (bytes?.length === 32) {
    return `0x${Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return undefined;
}

/** Read the Hyperlane message id from a Cosmos bridge_out event. */
export function messageIdFromCosmosTx(response: CosmosTxResponse): string {
  for (const event of response.tx_response?.events ?? []) {
    if (event.type !== 'bridge_out') continue;
    for (const attribute of event.attributes ?? []) {
      if (attribute.key === 'message_id' || attribute.key === 'messageId') {
        return messageIdValue(attribute.value) ?? '';
      }
    }
  }
  return '';
}
