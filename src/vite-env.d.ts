/// <reference types="vite/client" />

/**
 * 本项目用到的环境变量。写成类型而不是散在代码里读 any，
 * 是为了拼错变量名时能在编译期发现。
 */
interface ImportMetaEnv {
  /** mock（默认，模拟数据 + 状态机）| chain（连真链） */
  readonly VITE_API_MODE?: 'mock' | 'chain';

  /**
   * Atoshi 的 Cosmos REST（LCD）根地址，chain 模式必填。
   * 对应节点 app.toml 的 [api]，默认端口 1317。
   * ⚠️ 不是 EVM JSON-RPC（8545），也不是 CometBFT RPC（26657）。
   */
  readonly VITE_REST_URL?: string;

  /** Atoshi 的 EVM JSON-RPC，用于等交易回执 */
  readonly VITE_ATOSHI_EVM_RPC?: string;
  /** Atoshi 的 EVM chain id，同时也是它的 Hyperlane domain id。默认 88288 */
  readonly VITE_ATOSHI_CHAIN_ID?: string;
  readonly VITE_ATOSHI_EXPLORER?: string;
  /** Blockscout API v2；留空时使用 <VITE_ATOSHI_EXPLORER>/api/v2 */
  readonly VITE_ATOSHI_EXPLORER_API?: string;

  /**
   * 以太坊侧的 chain id，同时也是 Hyperlane domain id。
   * 必须和链上 bridgeadapter 参数里的 ethereum_domain 一致，
   * 不一致的话跨链消息会被目标链拒掉。测试网 11155111（Sepolia），主网 1。
   */
  readonly VITE_ETH_CHAIN_ID?: string;
  /** 以太坊侧 RPC。留空用 viem 内置的公共端点（有速率限制，生产要自己配） */
  readonly VITE_ETH_RPC_URL?: string;

  /** 以太坊侧 ERC20 ATOS 的合约地址。未部署时留空 */
  readonly VITE_ERC20_ATOS_ADDRESS?: string;
  /** Hyperlane HypERC20Collateral 的地址（桥入的金库）。未部署时留空 */
  readonly VITE_COLLATERAL_ADDRESS?: string;

  /** 没连钱包时用哪个地址查只读数据 */

  /** 质押币最小单位，默认 liao */
  readonly VITE_BOND_DENOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
