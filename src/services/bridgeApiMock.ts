import {
  BridgeLimits,
  BridgeParams,
  BridgeRecord,
  BridgeDirection,
  TxStep,
  AddressBookItem,
} from '../types';
import { formatEthAddressTo32Bytes } from '../utils/bridgeValidation';

// 默认基础参数
export const DEFAULT_PARAMS: BridgeParams = {
  atos_per_erc20: 100,
  min_transfer_out: 1000,
  global_daily_cap: 50_000_000, // 50,000,000 ATOS
  global_daily_cap_bps_of_pool: 500, // 5%
  per_address_daily_bps: 200, // 2%
  small_transfer_threshold: 100_000, // 100,000 ATOS
  small_quota_bps: 2000, // 20%
  crisis_pool_bps: 1000, // 10%
  bridge_enabled: true,
  ethereum_domain: 1, // Mainnet
  migration_pool_balance: 1_200_000_000, // 1.2B ATOS
  migration_pool_total: 10_000_000_000, // 10B ATOS (当前约 12% > 10%)
};

// 预设地址
export const DEMO_ATOSHI_ADDRESS = 'atoshi1qypqxpq9qcrsszg2pvxq6rs0zqg3y5z2h8v9a2';
export const DEMO_ETH_ADDRESS = '0x71C8F3b146437930f78FEA093eD414A0A45331Eb';

// 模拟预设测试场景
export type TestScenario =
  | 'normal'
  | 'crisis_mode'
  | 'large_exhausted'
  | 'address_cap_exhausted'
  | 'global_cap_exhausted'
  | 'bridge_disabled'
  | 'low_balance'
  | 'waiting_liquidity_in';

class BridgeService {
  private params: BridgeParams = { ...DEFAULT_PARAMS };
  private currentScenario: TestScenario = 'normal';
  private userBalanceAtos: number = 3_850_000;
  private userBalanceErc20: number = 25_000;
  private currentAddress: string = DEMO_ATOSHI_ADDRESS;
  private currentEthAddress: string = DEMO_ETH_ADDRESS;
  private records: BridgeRecord[] = [];
  private addressBook: AddressBookItem[] = [
    {
      id: 'addr_1',
      label: '我的 MetaMask 钱包 (主网)',
      address: '0x71C8F3b146437930f78FEA093eD414A0A45331Eb',
      network: 'ethereum',
      lastUsedAt: Date.now() - 3600000 * 2,
    },
    {
      id: 'addr_2',
      label: '冷钱包 Ledger',
      address: '0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97',
      network: 'ethereum',
      lastUsedAt: Date.now() - 3600000 * 48,
    },
    {
      id: 'addr_3',
      label: '币安充值地址 (勿直接填)',
      address: '0x28C6c06298d514Db089934071355E5743bf21d60',
      network: 'ethereum',
      lastUsedAt: Date.now() - 3600000 * 100,
    },
    {
      id: 'addr_4',
      label: 'Atoshi 移动端主账户',
      address: DEMO_ATOSHI_ADDRESS,
      network: 'atoshi',
      lastUsedAt: Date.now() - 3600000,
    },
  ];

  constructor() {
    this.loadFromStorage();
    this.initDemoHistoryIfEmpty();
    this.startBackgroundPoller();
  }

  private loadFromStorage() {
    try {
      const savedRecords = localStorage.getItem('atoshi_bridge_records');
      if (savedRecords) {
        this.records = JSON.parse(savedRecords);
      }
      const savedScenario = localStorage.getItem('atoshi_bridge_scenario');
      if (savedScenario) {
        this.currentScenario = savedScenario as TestScenario;
      }
      const savedBalance = localStorage.getItem('atoshi_bridge_balance');
      if (savedBalance) {
        this.userBalanceAtos = Number(savedBalance);
      }
    } catch {
      // ignore
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem('atoshi_bridge_records', JSON.stringify(this.records));
      localStorage.setItem('atoshi_bridge_scenario', this.currentScenario);
      localStorage.setItem('atoshi_bridge_balance', String(this.userBalanceAtos));
    } catch {
      // ignore
    }
  }

  private initDemoHistoryIfEmpty() {
    if (this.records.length === 0) {
      const now = Date.now();
      const completedSteps: TxStep[] = [
        {
          id: 1,
          name: '已提交',
          description: '交易在 Atoshi 钱包签名并广播',
          status: 'completed',
          timestamp: now - 3600000 * 3,
        },
        {
          id: 2,
          name: '已在 Atoshi 上锁定',
          description: '主网合约成功锁定 50,000 ATOS',
          status: 'completed',
          timestamp: now - 3600000 * 3 + 12000,
          txHash: '0x9a8f2d01e4839cfbe485892c90a42183e89bf234857492cda1982738fa09bc41',
          explorerUrl: 'https://explorer.atoshi.org/tx/0x9a8f2d01e4839cfbe485892c90a42183e89bf234857492cda1982738fa09bc41',
        },
        {
          id: 3,
          name: '跨链消息已发出',
          description: 'Hyperlane 验证节点完成共识并派发',
          status: 'completed',
          timestamp: now - 3600000 * 3 + 45000,
          messageId: '0x3f5c189e472091ea2837bc9401f8273645019827364510293847561029384756',
          explorerUrl: 'https://explorer.hyperlane.xyz/message/0x3f5c189e472091ea2837bc9401f8273645019827364510293847561029384756',
        },
        {
          id: 4,
          name: '以太坊已放款',
          description: '以太坊合约释放 500 ERC20 ATOS 至接收地址',
          status: 'completed',
          timestamp: now - 3600000 * 3 + 135000,
          txHash: '0x12d34e56f7890123456789abcdef0123456789abcdef0123456789abcdef0123',
          explorerUrl: 'https://etherscan.io/tx/0x12d34e56f7890123456789abcdef0123456789abcdef0123456789abcdef0123',
        },
      ];

      this.records = [
        {
          id: 'tx_rec_1',
          direction: 'out',
          amount: 50000,
          receivedAmount: 500,
          sender: DEMO_ATOSHI_ADDRESS,
          recipient: DEMO_ETH_ADDRESS,
          recipientFormatted32b: formatEthAddressTo32Bytes(DEMO_ETH_ADDRESS),
          status: 'completed',
          currentStep: 4,
          steps: completedSteps,
          messageId: '0x3f5c189e472091ea2837bc9401f8273645019827364510293847561029384756',
          sourceTxHash: '0x9a8f2d01e4839cfbe485892c90a42183e89bf234857492cda1982738fa09bc41',
          destTxHash: '0x12d34e56f7890123456789abcdef0123456789abcdef0123456789abcdef0123',
          createdAt: now - 3600000 * 3,
          updatedAt: now - 3600000 * 3 + 135000,
          estimatedTimeRange: '1–5 分钟',
        },
        {
          id: 'tx_rec_2',
          direction: 'in',
          amount: 200,
          receivedAmount: 20000,
          sender: DEMO_ETH_ADDRESS,
          recipient: DEMO_ATOSHI_ADDRESS,
          status: 'completed',
          currentStep: 4,
          steps: [
            { id: 1, name: '已在以太坊提交', description: '以太坊钱包发起 Lock 交易', status: 'completed', timestamp: now - 3600000 * 24 },
            { id: 2, name: '以太坊上已锁定', description: '以太坊合约锁定 200 ERC20 ATOS', status: 'completed', timestamp: now - 3600000 * 24 + 20000, txHash: '0x9876543210abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
            { id: 3, name: '跨链消息传输中', description: 'Hyperlane 验证跨链事件', status: 'completed', timestamp: now - 3600000 * 24 + 60000, messageId: '0x8888189e472091ea2837bc9401f8273645019827364510293847561029388888' },
            { id: 4, name: 'Atoshi 已放款', description: 'Atoshi 链上释放 20,000 ATOS', status: 'completed', timestamp: now - 3600000 * 24 + 110000, txHash: '0xabcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890' },
          ],
          createdAt: now - 3600000 * 24,
          updatedAt: now - 3600000 * 24 + 110000,
          estimatedTimeRange: '1–5 分钟',
        },
      ];
      this.saveToStorage();
    }
  }

  // 状态机自动步进轮询器
  private startBackgroundPoller() {
    setInterval(() => {
      let changed = false;
      const now = Date.now();

      this.records.forEach((record) => {
        if (record.status !== 'completed' && record.status !== 'failed') {
          const elapsed = now - record.createdAt;

          // Bridge Out 进度模拟
          if (record.direction === 'out') {
            if (record.currentStep === 1 && elapsed > 4000) {
              record.currentStep = 2;
              record.status = 'locked';
              record.steps[1].status = 'completed';
              record.steps[1].timestamp = now;
              record.steps[1].txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
              record.steps[1].explorerUrl = `https://explorer.atoshi.org/tx/${record.steps[1].txHash}`;
              record.sourceTxHash = record.steps[1].txHash;
              record.steps[2].status = 'processing';
              changed = true;
            } else if (record.currentStep === 2 && elapsed > 12000) {
              record.currentStep = 3;
              record.status = 'dispatched';
              record.steps[2].status = 'completed';
              record.steps[2].timestamp = now;
              record.messageId = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
              record.steps[2].messageId = record.messageId;
              record.steps[2].explorerUrl = `https://explorer.hyperlane.xyz/message/${record.messageId}`;
              record.steps[3].status = 'processing';
              changed = true;
            } else if (record.currentStep === 3 && elapsed > 24000) {
              record.currentStep = 4;
              record.status = 'completed';
              record.steps[3].status = 'completed';
              record.steps[3].timestamp = now;
              record.destTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
              record.steps[3].txHash = record.destTxHash;
              record.steps[3].explorerUrl = `https://etherscan.io/tx/${record.destTxHash}`;
              record.updatedAt = now;
              changed = true;
            }
          }

          // Bridge In 进度模拟
          if (record.direction === 'in') {
            if (record.currentStep === 1 && elapsed > 4000) {
              record.currentStep = 2;
              record.status = 'locked';
              record.steps[1].status = 'completed';
              record.steps[1].timestamp = now;
              record.steps[1].txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
              record.steps[1].explorerUrl = `https://etherscan.io/tx/${record.steps[1].txHash}`;
              record.sourceTxHash = record.steps[1].txHash;
              record.steps[2].status = 'processing';
              changed = true;
            } else if (record.currentStep === 2 && elapsed > 12000) {
              if (this.currentScenario === 'waiting_liquidity_in') {
                record.status = 'waiting_liquidity';
                record.steps[2].status = 'waiting_liquidity';
                record.steps[2].description = '跨链消息已抵达 Atoshi，正等待资金池自动补充流动性放款中...';
              } else {
                record.currentStep = 3;
                record.status = 'dispatched';
                record.steps[2].status = 'completed';
                record.steps[2].timestamp = now;
                record.messageId = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
                record.steps[2].messageId = record.messageId;
                record.steps[3].status = 'processing';
              }
              changed = true;
            } else if (record.currentStep === 3 && elapsed > 24000) {
              record.currentStep = 4;
              record.status = 'completed';
              record.steps[3].status = 'completed';
              record.steps[3].timestamp = now;
              record.destTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
              record.steps[3].txHash = record.destTxHash;
              record.steps[3].explorerUrl = `https://explorer.atoshi.org/tx/${record.destTxHash}`;
              record.updatedAt = now;
              changed = true;
            }
          }
        }
      });

      if (changed) {
        this.saveToStorage();
      }
    }, 2000);
  }

  // 获取下一个重置时间（明日 UTC 00:00:00）
  public getNextResetTimestamp(): number {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
  }

  // 场景切换器（供评审和 QA 验证所有五层限流及边缘分支）
  public setScenario(scenario: TestScenario) {
    this.currentScenario = scenario;
    if (scenario === 'bridge_disabled') {
      this.params.bridge_enabled = false;
    } else {
      this.params.bridge_enabled = true;
    }

    if (scenario === 'low_balance') {
      this.userBalanceAtos = 800; // 低于 1,000
    } else if (scenario === 'normal') {
      this.userBalanceAtos = 3_850_000;
    }
    this.saveToStorage();
  }

  public getScenario(): TestScenario {
    return this.currentScenario;
  }

  public getUserBalanceAtos(): number {
    return this.userBalanceAtos;
  }

  public getUserBalanceErc20(): number {
    return this.userBalanceErc20;
  }

  public getCurrentAddress(): string {
    return this.currentAddress;
  }

  public getCurrentEthAddress(): string {
    return this.currentEthAddress;
  }

  public getAddressBook(): AddressBookItem[] {
    return this.addressBook;
  }

  public addAddressBookItem(label: string, address: string, network: 'ethereum' | 'atoshi'): AddressBookItem {
    const newItem: AddressBookItem = {
      id: `addr_${Date.now()}`,
      label,
      address,
      network,
      lastUsedAt: Date.now(),
    };
    this.addressBook.unshift(newItem);
    return newItem;
  }

  /**
   * 接口 1: GET /bridge/params
   */
  public async getBridgeParams(): Promise<BridgeParams> {
    // 模拟网络延迟
    await new Promise((r) => setTimeout(r, 80));
    return { ...this.params };
  }

  /**
   * 接口 2: GET /bridge/limits?address={atoshi_addr}
   * 额度面板的唯一数据源，后端一次返回全部计算完毕的数值
   */
  public async getBridgeLimits(address: string = this.currentAddress): Promise<BridgeLimits> {
    await new Promise((r) => setTimeout(r, 100));

    const globalTotal = 50_000_000; // 5000 万 ATOS
    const largeTotal = Math.floor(globalTotal * 0.8); // 80% 大额配额 = 40,000,000
    const addressTotal = Math.floor(globalTotal * 0.02); // 2% 个人日上限 = 1,000,000

    let globalRemaining = 38_500_000;
    let largeRemaining = 28_500_000;
    let addressRemaining = 850_000;
    let isCrisis = false;

    // 根据不同测试场景调整返回数据
    if (this.currentScenario === 'crisis_mode') {
      isCrisis = true;
      globalRemaining = 20_000_000;
      largeRemaining = 0; // 危机模式大额归零
      addressRemaining = 500_000;
    } else if (this.currentScenario === 'large_exhausted') {
      largeRemaining = 0; // 大额用光，但小额还有 20% 配额
      globalRemaining = 10_000_000;
      addressRemaining = 800_000;
    } else if (this.currentScenario === 'address_cap_exhausted') {
      addressRemaining = 0; // 个人日额度用尽
    } else if (this.currentScenario === 'global_cap_exhausted') {
      globalRemaining = 0;
      largeRemaining = 0;
      addressRemaining = 0;
    }

    // 计算当前用户理论最大可转（取各层剩余的最小值）
    let maxTransferable = 0;
    if (this.params.bridge_enabled) {
      if (isCrisis) {
        // 危机模式最多只能转小额上限 100,000
        maxTransferable = Math.min(100_000, addressRemaining, globalRemaining, this.userBalanceAtos);
      } else {
        // 正常模式：用户最大单笔能转的值受限于个人日剩余、全网剩余、大额可用池及钱包余额
        const ceiling = Math.min(addressRemaining, globalRemaining, largeRemaining, this.userBalanceAtos);
        maxTransferable = Math.max(0, ceiling);
      }
      // 向下取整到 100 的整数倍
      maxTransferable = Math.floor(maxTransferable / 100) * 100;
    }

    return {
      max_transferable: maxTransferable,
      global_remaining: globalRemaining,
      global_total: globalTotal,
      large_remaining: largeRemaining,
      large_total: largeTotal,
      address_remaining: addressRemaining,
      address_total: addressTotal,
      crisis_mode: isCrisis,
      inbound_cap: 3_000_000_000,
    inbound_remaining: 3_000_000_000,
    rate_limits_disabled: false,
    resets_at: this.getNextResetTimestamp(),
      // mock 的已用量是编的，但它是"真实存在的数据"这一点为真 ——
      // 真链模式下这个字段是 false，UI 据此提示"已用量未知"
      usage_available: true,
    };
  }

  /**
   * 接口 3: GET /bridge/history?address={addr}&direction={out|in}&cursor=
   */
  public async getBridgeHistory(
    address: string = this.currentAddress,
    direction?: BridgeDirection,
    cursor?: string
  ): Promise<{ list: BridgeRecord[]; nextCursor?: string; total: number }> {
    await new Promise((r) => setTimeout(r, 120));

    let filtered = [...this.records];
    if (direction) {
      filtered = filtered.filter((r) => r.direction === direction);
    }
    // 排序：最新在前
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    return {
      list: filtered,
      nextCursor: undefined,
      total: filtered.length,
    };
  }

  /**
   * 接口 4: GET /bridge/status?message_id={id}
   */
  public async getBridgeStatus(messageId: string): Promise<BridgeRecord | null> {
    await new Promise((r) => setTimeout(r, 60));
    const found = this.records.find((r) => r.messageId === messageId || r.id === messageId);
    return found ? { ...found } : null;
  }

  /**
   * 交易接口 1: POST /bridge/out { sender, recipient_eth_address, amount_atos }
   */
  public async submitBridgeOut(data: {
    sender: string;
    recipient_eth_address: string;
    amount_atos: number;
  }): Promise<{ tx_hash: string; message_id: string; record: BridgeRecord }> {
    await new Promise((r) => setTimeout(r, 800));

    if (!this.params.bridge_enabled) {
      throw new Error('bridge_disabled');
    }

    const now = Date.now();
    const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    const mockMessageId = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

    const steps: TxStep[] = [
      {
        id: 1,
        name: '已提交',
        description: '交易在 Atoshi 钱包签名并广播',
        status: 'completed',
        timestamp: now,
      },
      {
        id: 2,
        name: '已在 Atoshi 上锁定',
        description: `主网合约锁定 ${data.amount_atos.toLocaleString()} ATOS`,
        status: 'processing',
        timestamp: now + 3000,
        txHash: mockTxHash,
        explorerUrl: `https://explorer.atoshi.org/tx/${mockTxHash}`,
      },
      {
        id: 3,
        name: '跨链消息已发出',
        description: 'Hyperlane 验证节点完成共识并派发',
        status: 'pending',
      },
      {
        id: 4,
        name: '以太坊已放款',
        description: `以太坊合约释放 ${(data.amount_atos / 100).toLocaleString()} ERC20 ATOS 至接收地址`,
        status: 'pending',
      },
    ];

    const newRecord: BridgeRecord = {
      id: `tx_${Date.now()}`,
      direction: 'out',
      amount: data.amount_atos,
      receivedAmount: data.amount_atos / 100,
      sender: data.sender,
      recipient: data.recipient_eth_address,
      recipientFormatted32b: formatEthAddressTo32Bytes(data.recipient_eth_address),
      status: 'submitted',
      currentStep: 1,
      steps,
      sourceTxHash: mockTxHash,
      createdAt: now,
      updatedAt: now,
      estimatedTimeRange: '1–5 分钟',
    };

    // 扣减本地模拟余额
    this.userBalanceAtos = Math.max(0, this.userBalanceAtos - data.amount_atos);
    this.records.unshift(newRecord);
    this.saveToStorage();

    return {
      tx_hash: mockTxHash,
      message_id: mockMessageId,
      record: newRecord,
    };
  }

  /**
   * 交易接口 2: POST /bridge/in { sender, recipient_atoshi_address, amount_erc20 }
   */
  public async submitBridgeIn(data: {
    sender: string;
    recipient_atoshi_address: string;
    amount_erc20: number;
  }): Promise<{ tx_hash: string; message_id: string; record: BridgeRecord }> {
    await new Promise((r) => setTimeout(r, 800));

    if (!this.params.bridge_enabled) {
      throw new Error('bridge_disabled');
    }

    const now = Date.now();
    const mockEthTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    const mockMessageId = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

    const steps: TxStep[] = [
      {
        id: 1,
        name: '已在以太坊提交',
        description: '以太坊钱包发起 ERC20 锁定交易',
        status: 'completed',
        timestamp: now,
      },
      {
        id: 2,
        name: '以太坊上已锁定',
        description: `以太坊合约锁定 ${data.amount_erc20.toLocaleString()} ERC20 ATOS`,
        status: 'processing',
        timestamp: now + 3000,
        txHash: mockEthTxHash,
        explorerUrl: `https://etherscan.io/tx/${mockEthTxHash}`,
      },
      {
        id: 3,
        name: '跨链消息传输中',
        description: 'Hyperlane 验证跨链凭证并派发至 Atoshi 链',
        status: 'pending',
      },
      {
        id: 4,
        name: 'Atoshi 已放款',
        description: `Atoshi 主网释放 ${(data.amount_erc20 * 100).toLocaleString()} ATOS 到您的地址`,
        status: 'pending',
      },
    ];

    const newRecord: BridgeRecord = {
      id: `tx_${Date.now()}`,
      direction: 'in',
      amount: data.amount_erc20,
      receivedAmount: data.amount_erc20 * 100,
      sender: data.sender,
      recipient: data.recipient_atoshi_address,
      status: 'submitted',
      currentStep: 1,
      steps,
      sourceTxHash: mockEthTxHash,
      createdAt: now,
      updatedAt: now,
      estimatedTimeRange: '1–5 分钟',
    };

    this.userBalanceErc20 = Math.max(0, this.userBalanceErc20 - data.amount_erc20);
    this.records.unshift(newRecord);
    this.saveToStorage();

    return {
      tx_hash: mockEthTxHash,
      message_id: mockMessageId,
      record: newRecord,
    };
  }

  // 模拟重试放款（针对 Bridge In 等待流动性补充中）
  public async retryBridgeIn(recordId: string): Promise<boolean> {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) return false;
    record.status = 'dispatched';
    record.currentStep = 3;
    record.steps[2].status = 'completed';
    record.steps[2].description = '资金池已补充，跨链消息验证通过';
    record.steps[3].status = 'processing';
    this.saveToStorage();
    return true;
  }
}

export const bridgeServiceMock = new BridgeService();
