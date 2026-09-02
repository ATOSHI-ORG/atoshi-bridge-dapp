/**
 * bridgeService 的切换层。UI 只 import 这个文件。
 *
 *   VITE_API_MODE=mock   （默认）内置模拟数据 + 状态机模拟，不需要节点和钱包。
 *   VITE_API_MODE=chain  连真链。
 *
 * 桥的 mock 不只是「假数据」，它还模拟了跨链状态机的自动步进和五层限流的
 * 各种边缘场景（setScenario），是产品评审和 QA 验证 UI 分支的唯一手段 ——
 * 真链上很难凑出「大额配额耗尽」「危机模式」这些状态。所以 mock 会长期保留，
 * 不是过渡产物。
 *
 * 两个模式下 mock 独有的能力（场景切换、状态机自动步进）在 chain 模式下不存在，
 * 见下面的 SCENARIOS_AVAILABLE。
 */

import { bridgeServiceMock, DEMO_ATOSHI_ADDRESS, DEMO_ETH_ADDRESS } from './bridgeApiMock';
import { bridgeServiceChain } from './bridgeApiChain';
import { REST_BASE } from './chainRest';

export type ApiMode = 'mock' | 'chain';

export const API_MODE: ApiMode = (() => {
  const mode = (import.meta.env.VITE_API_MODE as string | undefined)?.trim();
  if (mode === 'chain') {
    if (!REST_BASE) {
      throw new Error(
        'VITE_API_MODE=chain 但没有配置 VITE_REST_URL。' +
          '桥的链上参数需要节点的 Cosmos REST 端点（app.toml 的 [api]，默认 1317），' +
          '不是 EVM JSON-RPC（8545）。',
      );
    }
    return 'chain';
  }
  return 'mock';
})();

export const IS_CHAIN_MODE = API_MODE === 'chain';

/** 场景切换只有 mock 有。UI 上那个测试面板在 chain 模式下要隐藏。 */
export const SCENARIOS_AVAILABLE = !IS_CHAIN_MODE;

/**
 * 统一后的服务接口。
 *
 * mock 的余额方法是同步无参的，真链的必须异步（要发请求）且需要地址。
 * 在这里对齐成「异步 + 可选地址」，UI 一处改动即可，不用在两边各写一套。
 */
export const bridgeService = {
  getBridgeParams: () =>
    IS_CHAIN_MODE ? bridgeServiceChain.getBridgeParams() : bridgeServiceMock.getBridgeParams(),

  getBridgeLimits: (address?: string) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.getBridgeLimits(address)
      : bridgeServiceMock.getBridgeLimits(address),

  getBridgeHistory: (address?: string, direction?: any, cursor?: string) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.getBridgeHistory(address, direction, cursor)
      : bridgeServiceMock.getBridgeHistory(address, direction, cursor),

  getBridgeStatus: (messageId: string) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.getBridgeStatus(messageId)
      : bridgeServiceMock.getBridgeStatus(messageId),

  submitBridgeOut: (data: {
    sender: string;
    recipient_eth_address: string;
    amount_atos: number;
  }) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.submitBridgeOut(data)
      : bridgeServiceMock.submitBridgeOut(data),

  submitBridgeIn: (data: {
    sender: string;
    recipient_atoshi_address: string;
    amount_erc20: number;
  }) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.submitBridgeIn(data)
      : bridgeServiceMock.submitBridgeIn(data),

  retryBridgeIn: (recordId: string) =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.retryBridgeIn(recordId)
      : bridgeServiceMock.retryBridgeIn(recordId),

  /** 异步：真链要发请求。address 为空时返回 0（未连钱包）。 */
  getUserBalanceAtos: async (address?: string): Promise<number> => {
    if (!IS_CHAIN_MODE) return bridgeServiceMock.getUserBalanceAtos();
    if (!address) return 0;
    return bridgeServiceChain.getUserBalanceAtos(address);
  },

  getUserBalanceErc20: async (): Promise<number> => {
    if (!IS_CHAIN_MODE) return bridgeServiceMock.getUserBalanceErc20();
    return bridgeServiceChain.getUserBalanceErc20();
  },

  getNextResetTimestamp: () =>
    IS_CHAIN_MODE
      ? bridgeServiceChain.getNextResetTimestamp()
      : bridgeServiceMock.getNextResetTimestamp(),

  // 地址簿存在 localStorage，两个模式共用一份实现
  getAddressBook: () => bridgeServiceMock.getAddressBook(),
  addAddressBookItem: (label: string, address: string, network: 'ethereum' | 'atoshi') =>
    bridgeServiceMock.addAddressBookItem(label, address, network),

  // 只有 mock 有。chain 模式下调用是空操作，UI 应该先看 SCENARIOS_AVAILABLE
  setScenario: (s: any) => {
    if (!IS_CHAIN_MODE) bridgeServiceMock.setScenario(s);
  },
  getScenario: () => (IS_CHAIN_MODE ? 'normal' : bridgeServiceMock.getScenario()),
};

/**
 * 没连钱包时的兜底地址，只用于首屏渲染和只读查询。
 * 连上钱包后由 useWallet 提供真实地址。
 */
export const FALLBACK_ATOSHI_ADDRESS =
  (import.meta.env.VITE_DEMO_ATOSHI_ADDRESS as string) || DEMO_ATOSHI_ADDRESS;
export const FALLBACK_ETH_ADDRESS =
  (import.meta.env.VITE_DEMO_ETH_ADDRESS as string) || DEMO_ETH_ADDRESS;

export { DEFAULT_PARAMS } from './bridgeApiMock';
export { ChainRestError } from './chainRest';
export type { TestScenario } from './bridgeApiMock';
