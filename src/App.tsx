/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BridgeParams,
  BridgeLimits,
  BridgeRecord,
  BridgeDirection,
  AddressBookItem,
} from './types';
import {
  bridgeService,
  IS_CHAIN_MODE,
  IS_MOCK_MODE,
} from './services/bridgeApi';
import { useWallet } from './wallet/useWallet';
import { WalletBar } from './components/WalletBar';
import { Header } from './components/Header';
import { BridgeOutView } from './components/BridgeOutView';
import { BridgeInView } from './components/BridgeInView';
import { RulesExplanationModal } from './components/RulesExplanationModal';
import { AddressBookModal } from './components/AddressBookModal';
import { TransactionModal } from './components/TransactionModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { FAQAndSupportModal } from './components/FAQAndSupportModal';
import { ShieldX } from 'lucide-react';
import { useI18n } from './i18n';

export default function App() {
  const { t } = useI18n();
  const [params, setParams] = useState<BridgeParams | null>(null);
  const [limits, setLimits] = useState<BridgeLimits | null>(null);
  const [records, setRecords] = useState<BridgeRecord[]>([]);
  const [activeDirection, setActiveDirection] = useState<BridgeDirection>('out');
  const [addressBook, setAddressBook] = useState<AddressBookItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // 初始值必须是「空」而不是演示数据。
  //
  // 这几个字段原来分别写死了 3,850,000 / 25,000 和一个 0x71C8… 的地址。没连
  // 钱包时页面照样显示这些数字和一个预填的收款地址，看起来像是查到了真实
  // 余额 —— 测试同学报的「未连钱包却有余额」「接收地址自动填了个不认识的
  // 地址」就是这个。
  const [balanceAtos, setBalanceAtos] = useState<number>(0);
  const [balanceErc20, setBalanceErc20] = useState<number>(0);
  const [recipientEth, setRecipientEth] = useState<string>('');
  const [recipientAtoshi, setRecipientAtoshi] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal 控制
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);
  const [isAddressBookOpen, setIsAddressBookOpen] = useState<boolean>(false);
  const [addressBookNetwork, setAddressBookNetwork] = useState<'ethereum' | 'atoshi'>('ethereum');
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState<boolean>(false);
  const [isFAQModalOpen, setIsFAQModalOpen] = useState<boolean>(false);
  const [activeRecord, setActiveRecord] = useState<BridgeRecord | null>(null);
  const [selectedTxIdForSupport, setSelectedTxIdForSupport] = useState<string | undefined>(undefined);

  // 钱包给的是 0x 地址，Cosmos REST 的查询路径只认 atoshi1…，useWallet 里已转好。
  //
  // 没连钱包时这里是空串，不再退回兜底地址。原来退回 FALLBACK_ATOSHI_ADDRESS
  // 是「让页面有东西可渲染」，但代价是顶栏显示一个用户并不拥有的地址、还带着
  // 绿色的已连接圆点，并且拿那个地址去查余额和额度。
  const wallet = useWallet();
  const currentAddress = wallet.bech32Address;
  const currentEthAddress = wallet.address || '';
  const isConnected = wallet.isConnected && Boolean(currentAddress);

  // 加载数据
  const fetchData = useCallback(async () => {
    try {
      // 参数和限流上限是全局的，不连钱包也能看（页面上那句「查看额度无需连接」）。
      // 余额、已用额度、历史都是按地址的 —— 没地址就不要发这些请求：拿空串去
      // 查会得到一个看起来正常但毫无意义的结果。
      const [fetchedParams, fetchedLimits] = await Promise.all([
        bridgeService.getBridgeParams(),
        bridgeService.getBridgeLimits(currentAddress || undefined),
      ]);
      setParams(fetchedParams);
      setLimits(fetchedLimits);
      setAddressBook(bridgeService.getAddressBook());

      if (currentAddress) {
        const [fetchedHistory, atos, erc20] = await Promise.all([
          bridgeService.getBridgeHistory(currentAddress),
          bridgeService.getUserBalanceAtos(currentAddress),
          // ERC20 余额是以太坊侧的合约调用，钱包没连到那条链时查不到
          bridgeService.getUserBalanceErc20().catch(() => 0),
        ]);
        setRecords(fetchedHistory.list);
        setBalanceAtos(atos);
        setBalanceErc20(erc20);

        // 正开着的交易弹窗要跟着刷新状态
        if (activeRecord) {
          const updated = fetchedHistory.list.find((r) => r.id === activeRecord.id);
          if (updated) setActiveRecord(updated);
        }
      } else {
        setRecords([]);
        setBalanceAtos(0);
        setBalanceErc20(0);
      }
      setLoadError(null);
    } catch (e: any) {
      // 不再静默忽略。mock 模式下这里几乎不会触发；真链模式下节点连不上、
      // 跨域被拦、REST 没开，全都走到这儿 —— 吞掉的话页面只是不更新，
      // 看起来一切正常，是最难排查的一种故障。
      setLoadError(e?.message || '读取链上数据失败');
    }
  }, [currentAddress, activeRecord]);

  // 收款地址跟着钱包走：连上就填自己的地址，断开就清空。
  //
  // 桥出收的是以太坊地址，桥入收的是 Atoshi 地址，而钱包的同一把密钥两边都有
  // 表示形式，所以两个方向都能自动填。用户改过之后不再覆盖（只在地址本身变化
  // 时同步），否则输入一半会被刷掉。
  useEffect(() => {
    setRecipientEth(currentEthAddress || '');
  }, [currentEthAddress]);

  useEffect(() => {
    setRecipientAtoshi(currentAddress || '');
  }, [currentAddress]);

  useEffect(() => {
    fetchData();
    // mock 的状态机靠这个轮询自动步进，所以要快。真链模式下没有东西会自己
    // 步进，2.5 秒一轮就是每秒两次 REST 请求的纯浪费，还容易被限流。
    const interval = setInterval(fetchData, IS_CHAIN_MODE ? 15000 : 2500);
    return () => clearInterval(interval);
  }, [fetchData]);

  // 桥出提交处理
  const handleSubmitBridgeOut = async (amount: number, recipientEth: string) => {
    setIsSubmitting(true);
    try {
      const res = await bridgeService.submitBridgeOut({
        sender: currentAddress,
        recipient_eth_address: recipientEth,
        amount_atos: amount,
      });
      await fetchData();
      setActiveRecord(res.record);
    } catch (err: any) {
      alert(`跨链失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 桥入提交处理
  const handleSubmitBridgeIn = async (amountErc20: number, recipientAtoshi: string) => {
    setIsSubmitting(true);
    try {
      const res = await bridgeService.submitBridgeIn({
        sender: currentEthAddress,
        recipient_atoshi_address: recipientAtoshi,
        amount_erc20: amountErc20,
      });
      await fetchData();
      setActiveRecord(res.record);
    } catch (err: any) {
      alert(`以太坊跨链发起失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重试桥入放款
  const handleRetryBridgeIn = async (recordId: string) => {
    await bridgeService.retryBridgeIn(recordId);
    await fetchData();
  };

  // 打开地址簿
  const handleOpenAddressBook = (network: 'ethereum' | 'atoshi') => {
    setAddressBookNetwork(network);
    setIsAddressBookOpen(true);
  };

  const handleAddNewAddress = (label: string, address: string, network: 'ethereum' | 'atoshi') => {
    bridgeService.addAddressBookItem(label, address, network);
    setAddressBook(bridgeService.getAddressBook());
  };

  const pendingCount = records.filter(
    (r) => r.status !== 'completed' && r.status !== 'failed'
  ).length;

  const isBridgeDisabled = params && !params.bridge_enabled;

  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-start sm:justify-center py-0 sm:py-6 px-0 sm:px-4 selection:bg-black selection:text-white">
      {/*
        自适应外壳。
        手机（默认）：420px 竖屏卡片，铺满屏幕高度。
        桌面（lg 起）：加宽到 1040px，内容分两栏 —— 表单在左，额度面板在右。
        分栏由 BridgeOutView 自己的 lg:grid 负责，这里只放开宽度。
      */}
      <div className="w-full max-w-[420px] bg-white min-h-screen sm:min-h-0 sm:rounded-2xl shadow-2xl border border-gray-200 flex flex-col relative overflow-hidden lg:max-w-[1040px]">
        {/*
          mock 模式必须一眼看出来。
          这个模式会编造交易哈希并把流程走完打上「已完成」，和真链在界面上
          没有任何区别 —— 一次忘配环境变量就足以让人以为跨链成功了。
        */}
        {IS_MOCK_MODE && (
          <div className="bg-amber-500 text-white text-[11px] font-bold text-center py-1.5 px-3 leading-snug">
            演示模式（VITE_API_MODE=mock）：数据与交易哈希都是模拟的，链上不会发生任何事
          </div>
        )}

        {/* 顶部导航与方向切换 */}
        <Header
          currentAddress={currentAddress}
          isConnected={isConnected}
          balanceAtos={balanceAtos}
          activeDirection={activeDirection}
          onDirectionChange={setActiveDirection}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onOpenFAQ={() => {
            setSelectedTxIdForSupport(undefined);
            setIsFAQModalOpen(true);
          }}
          pendingCount={pendingCount}
          bridgeEnabled={params?.bridge_enabled ?? true}
        />

        <WalletBar
          side={activeDirection === 'out' ? 'atoshi' : 'ethereum'}
          isConnected={wallet.isConnected}
          isConnecting={wallet.isConnecting}
          isSwitching={wallet.isSwitching}
          hasProvider={wallet.hasProvider}
          isOnRightChain={wallet.isOnChainFor(activeDirection === 'out' ? 'atoshi' : 'ethereum')}
          loadError={loadError}
          onConnect={wallet.connect}
          onSwitch={() => wallet.switchTo(activeDirection === 'out' ? 'atoshi' : 'ethereum')}
        />

        {/* 主体内容 */}
        <main className="p-6 space-y-4 flex-1 lg:px-10 lg:py-8">
          {/* 跨链功能暂停全屏遮罩状态 */}
          {isBridgeDisabled ? (
            <div
              id="bridge-disabled-banner"
              className="bg-orange-50 border border-orange-200 rounded-2xl p-6 text-center space-y-3 animate-in fade-in duration-200 my-8"
            >
              <div className="w-14 h-14 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto">
                <ShieldX className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-gray-900">{t('maint.title')}</h2>
              <p className="text-xs text-gray-600 leading-relaxed max-w-xs mx-auto">
                {t('maint.desc')}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={fetchData}
                  className="px-4 py-2 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  {t('maint.btn_restore')}
                </button>
              </div>
            </div>
          ) : activeDirection === 'out' ? (
            /* 桥出视图（Atoshi ➔ ETH，五层限流核心实现） */
            <BridgeOutView
              params={params}
              limits={limits}
              userBalance={balanceAtos}
              userAddress={currentAddress}
              addressBook={addressBook}
              recipientEth={recipientEth}
              onRecipientEthChange={setRecipientEth}
              isSubmitting={isSubmitting}
              isConnected={isConnected}
              onSubmit={handleSubmitBridgeOut}
              onOpenRulesModal={() => setIsRulesModalOpen(true)}
              onOpenAddressBook={() => handleOpenAddressBook('ethereum')}
            />
          ) : (
            /* 桥入视图（ETH ➔ Atoshi，无限流，等待流动性补充状态机） */
            <BridgeInView
              params={params}
              userErc20Balance={balanceErc20}
              currentAtoshiAddress={currentAddress}
              recipientAtoshi={recipientAtoshi}
              onRecipientAtoshiChange={setRecipientAtoshi}
              addressBook={addressBook}
              isSubmitting={isSubmitting}
              isConnected={isConnected}
              onSubmit={handleSubmitBridgeIn}
              onOpenAddressBook={() => handleOpenAddressBook('atoshi')}
              onOpenFAQ={() => {
                setSelectedTxIdForSupport(undefined);
                setIsFAQModalOpen(true);
              }}
            />
          )}
        </main>

        {/* 底部信息与品牌 */}
        <footer className="px-6 py-3.5 border-t border-gray-100 bg-white text-center text-[10px] text-gray-400 font-mono space-y-0.5">
          <div>{t('app.footer_text')}</div>
          <div className="text-[9px] text-gray-400">
            {t('app.footer_sub')}
          </div>
        </footer>
      </div>

      {/* 弹窗组件群 */}
      {/* 1. 五层限流规则详解弹窗 */}
      <RulesExplanationModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        limits={limits}
        params={params}
      />

      {/* 2. 常用地址簿弹窗 */}
      <AddressBookModal
        isOpen={isAddressBookOpen}
        onClose={() => setIsAddressBookOpen(false)}
        network={addressBookNetwork}
        addressList={addressBook}
        onSelectAddress={(addr) => {
          if (addressBookNetwork === 'ethereum') {
            setRecipientEth(addr);
          } else {
            setRecipientAtoshi(addr);
          }
        }}
        onAddNewAddress={handleAddNewAddress}
      />

      {/* 3. 四步状态机进度追踪弹窗 */}
      <TransactionModal
        isOpen={!!activeRecord}
        onClose={() => setActiveRecord(null)}
        record={activeRecord}
        onOpenSupport={(recordId) => {
          setSelectedTxIdForSupport(recordId);
          setIsFAQModalOpen(true);
        }}
        onRetryBridgeIn={handleRetryBridgeIn}
      />

      {/* 4. 历史记录抽屉 */}
      <HistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        records={records}
        onSelectRecord={(rec) => {
          setIsHistoryDrawerOpen(false);
          setActiveRecord(rec);
        }}
      />

      {/* 5. 常见问题与客服支持弹窗 */}
      <FAQAndSupportModal
        isOpen={isFAQModalOpen}
        onClose={() => setIsFAQModalOpen(false)}
        selectedTxId={selectedTxIdForSupport}
      />
    </div>
  );
}
