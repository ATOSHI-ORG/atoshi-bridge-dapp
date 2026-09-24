import { ChainRestError } from '../services/chainRest';

export interface CosmosCoin {
  denom: string;
  amount: string;
}

export interface CosmosMessage {
  typeUrl: string;
  value: Record<string, unknown>;
}

export interface CosmosFee {
  amount: CosmosCoin[];
  gas: string;
}

interface CosmosBroadcastResult {
  txhash?: string;
  txHash?: string;
  tx_response?: { txhash?: string };
}

interface CosmosProvider {
  enable?: (chainId: string) => Promise<void>;
  getKey?: (chainId: string) => Promise<{ bech32Address: string }>;
  signAndBroadcast?: (
    chainId: string,
    signerAddress: string,
    messages: CosmosMessage[],
    fee: CosmosFee,
    memo?: string,
  ) => Promise<CosmosBroadcastResult | string>;
  sendCosmosTransaction?: (request: {
    chainId: string;
    signerAddress: string;
    messages: CosmosMessage[];
    fee: CosmosFee;
    memo?: string;
  }) => Promise<CosmosBroadcastResult | string>;
}

const CHAIN_ID = (import.meta.env.VITE_COSMOS_CHAIN_ID as string) || `atoshi_${import.meta.env.VITE_ATOSHI_CHAIN_ID || '88288'}-1`;
const GAS_LIMIT = (import.meta.env.VITE_COSMOS_GAS_LIMIT as string) || '400000';
const FEE_AMOUNT = (import.meta.env.VITE_COSMOS_FEE_AMOUNT as string) || '0';
const FEE_DENOM = (import.meta.env.VITE_BOND_DENOM as string) || 'liao';

function candidates(): CosmosProvider[] {
  if (typeof window === 'undefined') return [];
  const injected = window as Window & {
    atoshiCosmos?: CosmosProvider;
    cosmos?: CosmosProvider;
    keplr?: CosmosProvider;
  };
  return [injected.atoshiCosmos, injected.cosmos, injected.keplr].filter(
    (provider): provider is CosmosProvider =>
      Boolean(provider?.signAndBroadcast || provider?.sendCosmosTransaction),
  );
}

export function getCosmosProvider(): CosmosProvider | null {
  return candidates()[0] ?? null;
}

export function cosmosFee(): CosmosFee {
  return {
    amount: [{ denom: FEE_DENOM, amount: FEE_AMOUNT }],
    gas: GAS_LIMIT,
  };
}

export async function cosmosAccountAddress(): Promise<string> {
  const provider = getCosmosProvider();
  if (!provider) throw new ChainRestError('当前钱包没有提供 Cosmos 账户接口。');
  await provider.enable?.(CHAIN_ID);
  const address = (await provider.getKey?.(CHAIN_ID))?.bech32Address;
  if (!address) throw new ChainRestError('Cosmos 钱包没有返回 atoshi 地址。');
  return address;
}

function hashFromResult(result: CosmosBroadcastResult | string): string {
  if (typeof result === 'string') return result;
  const hash = result.txhash || result.txHash || result.tx_response?.txhash;
  if (!hash) throw new ChainRestError('Cosmos 钱包没有返回交易哈希。');
  return hash;
}

/** Sign and broadcast a native Cosmos transaction through the injected wallet. */
export async function broadcastCosmos(
  messages: CosmosMessage[],
  expectedAddress?: string,
): Promise<{ txHash: string; address: string }> {
  const provider = getCosmosProvider();
  if (!provider) throw new ChainRestError('当前钱包没有提供 Cosmos 交易接口。');

  const address = await cosmosAccountAddress();
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new ChainRestError(`页面账户（${expectedAddress}）与 Cosmos 钱包账户（${address}）不一致。`);
  }

  const fee = cosmosFee();
  const result = provider.signAndBroadcast
    ? await provider.signAndBroadcast(CHAIN_ID, address, messages, fee, '')
    : await provider.sendCosmosTransaction!({
        chainId: CHAIN_ID,
        signerAddress: address,
        messages,
        fee,
        memo: '',
      });

  return { txHash: hashFromResult(result), address };
}

export function bridgeOutMessage(params: {
  sender: string;
  recipient: `0x${string}`;
  amount: string;
}): CosmosMessage {
  const bytes = params.recipient.slice(2);
  const binary = bytes.match(/.{1,2}/g)?.map((byte) => String.fromCharCode(parseInt(byte, 16))).join('') || '';
  const recipient = btoa(binary);
  return {
    typeUrl: '/atoshi.bridgeadapter.v1.MsgBridgeOut',
    value: {
      sender: params.sender,
      recipient,
      amount: params.amount,
      maxFee: [],
    },
  };
}
