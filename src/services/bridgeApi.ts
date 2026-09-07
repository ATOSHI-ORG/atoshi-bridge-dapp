/**
 * bridgeService 的切换层。UI 只 import 这个文件。
 *
 *   VITE_API_MODE=chain  （默认）连真链。
 *   VITE_API_MODE=mock   内置模拟数据 + 状态机模拟，不需要节点和钱包。
 *
 * ⚠️ 默认必须是 chain，而且 mock 只能显式开启。
 *
 * 这个默认值曾经是 mock。后果不是「数据是假的」这么轻 —— mock 会**编造成功的
 * 交易哈希**并把跨链流程一路走完打上「已完成」。所以一次部署忘配环境变量，
 * 用户看到的就是「跨链成功」，而链上什么都没发生（实测：页面给出的两个哈希在
 * Atoshi 和 Sepolia 上都查不到，抵押金库余额和 lockedAmount 都是 0）。
 *
 * 一个桥的界面里，「静默假装成功」是所有默认值中最危险的一个。现在拼错
 * VITE_API_MODE 会连不上链并报错，而不是变成演示模式。
 *
 * 桥的 mock 不只是「假数据」，它还模拟了跨链状态机的自动步进和五层限流的
 * 各种边缘场景（setScenario），是产品评审和 QA 验证 UI 分支的唯一手段 ——
 * 真链上很难凑出「大额配额耗尽」「危机模式」这些状态。所以 mock 会长期保留，
 * 不是过渡产物。
 *
 * 两个模式下 mock 独有的能力（场景切换、状态机自动步进）在 chain 模式下不存在，
 * 见下面的 SCENARIOS_AVAILABLE。
 */

import { bridgeServiceMock } from './bridgeApiMock';
import { bridgeServiceChain } from './bridgeApiChain';
import { REST_BASE } from './chainRest';

export type ApiMode = 'mock' | 'chain';

export const API_MODE: ApiMode = (() => {
  const mode = (import.meta.env.VITE_API_MODE as string | undefined)?.trim();

  // mock 必须显式写出来。任何其它值（包括拼错、空、未设置）都走真链。
  if (mode === 'mock') return 'mock';

  if (!REST_BASE) {
    throw new Error(
      '没有配置 VITE_REST_URL。桥的链上参数需要节点的 Cosmos REST 端点' +
        '（app.toml 的 [api]，默认 1317），不是 EVM JSON-RPC（8545）。\n\n' +
        '要跑不连链的演示模式，显式设 VITE_API_MODE=mock —— 但那个模式会编造' +
        '交易哈希，绝不能部署给用户。',
    );
  }
  return 'chain';
})();

export const IS_CHAIN_MODE = API_MODE === 'chain';

/**
 * mock 模式必须在界面上有醒目提示。
 *
 * 没有提示的话，mock 和真链在界面上完全一样 —— 这正是「显示跨链成功但链上
 * 查不到」能一路走到测试同学手上的原因。
 */
export const IS_MOCK_MODE = API_MODE === 'mock';

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
// 兜底地址已经删掉了。
//
// 它原本用于「没连钱包时也让页面有东西可渲染」，代价是顶栏显示一个用户并不
// 拥有的地址、还带着已连接的绿点，并且拿它去查余额和额度。现在没连钱包就是
// 空，界面明确显示未连接。VITE_DEMO_* 两个环境变量随之作废。

export { DEFAULT_PARAMS } from './bridgeApiMock';
export { ChainRestError } from './chainRest';
export type { TestScenario } from './bridgeApiMock';
