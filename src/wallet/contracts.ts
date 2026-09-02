/**
 * 以太坊侧的合约。桥入（Ethereum → Atoshi）走这里。
 *
 * 资产桥用的是 **Hyperlane 官方的 HypERC20Collateral**，不是我们自己写的合约 ——
 * 它把 ERC20 锁在金库里、通过 Hyperlane 发消息让目标链释放。所以 ABI 就是
 * Hyperlane 的 TokenRouter 标准接口，这里只摘 UI 用到的三个方法。
 *
 * 桥入的完整流程是两笔交易，不是一笔：
 *   1. ERC20.approve(collateral, amount)   —— 授权金库来拉币
 *   2. collateral.transferRemote(...)      —— 发起跨链，msg.value 付跨链 gas
 * UI 上必须体现成两步，否则用户在第一笔签完之后会以为已经完成了。
 */

/** ERC20 ATOS（以太坊侧）。桥入要先 approve。 */
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

/** Hyperlane TokenRouter（HypERC20Collateral 实现了它）。 */
export const tokenRouterAbi = [
  {
    // recipient 是 32 字节的 Hyperlane 地址表示，不是 20 字节的 address。
    // 用 chains.ts 的 toHyperlane32Bytes 转，别自己拼。
    type: 'function',
    name: 'transferRemote',
    stateMutability: 'payable',
    inputs: [
      { name: 'destination', type: 'uint32' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'amountOrId', type: 'uint256' },
    ],
    outputs: [{ name: 'messageId', type: 'bytes32' }],
  },
  {
    // 跨链 gas 报价。必须作为 msg.value 一起付，付少了 relayer 不会转发，
    // 消息会一直挂着 —— 不是失败，是永远不到账，比失败更难排查。
    type: 'function',
    name: 'quoteGasPayment',
    stateMutability: 'view',
    inputs: [{ name: 'destinationDomain', type: 'uint32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    // 金库锁的是哪个 ERC20。用它交叉验证 VITE_ERC20_ATOS_ADDRESS 配得对不对 ——
    // 配错了 approve 会授权给一个无关的代币，然后 transferRemote 失败。
    type: 'function',
    name: 'wrappedToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

const addr = (v: string | undefined): `0x${string}` | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : undefined;

/**
 * 合约地址来自环境变量，因为**合约还没部署**。
 *
 * 留成 undefined 而不是填占位地址：填了假地址，桥入会走到 approve 然后失败在
 * 一个看不懂的 revert 上；留空则能在 UI 层给出「合约未部署」这句准话。
 */
export const ERC20_ATOS_ADDRESS = addr(import.meta.env.VITE_ERC20_ATOS_ADDRESS as string);
export const COLLATERAL_ADDRESS = addr(import.meta.env.VITE_COLLATERAL_ADDRESS as string);

export const ETH_CONTRACTS_READY = Boolean(ERC20_ATOS_ADDRESS && COLLATERAL_ADDRESS);

/** 桥入两笔交易的 gas 上限。approve 是标准 ERC20，transferRemote 要发跨链消息所以更贵。 */
export const GAS_LIMITS = {
  approve: 100_000n,
  transferRemote: 500_000n,
} as const;
