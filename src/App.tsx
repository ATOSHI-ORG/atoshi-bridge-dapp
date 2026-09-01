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
} from './services/bridgeApi';
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
  const [balanceAtos, setBalanceAtos] = useState<number>(3_850_000);
  const [balanceErc20, setBalanceErc20] = useState<number>(25_000);
  const [recipientEth, setRecipientEth] = useState<string>('0x71C8F3b146437930f78FEA093eD414A0A45331Eb');
  const [recipientAtoshi, setRecipientAtoshi] = useState<string>(bridgeService.getCurrentAddress());

  // Modal 控制
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);
  const [isAddressBookOpen, setIsAddressBookOpen] = useState<boolean>(false);
  const [addressBookNetwork, setAddressBookNetwork] = useState<'ethereum' | 'atoshi'>('ethereum');
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState<boolean>(false);
  const [isFAQModalOpen, setIsFAQModalOpen] = useState<boolean>(false);
  const [activeRecord, setActiveRecord] = useState<BridgeRecord | null>(null);
  const [selectedTxIdForSupport, setSelectedTxIdForSupport] = useState<string | undefined>(undefined);

  const currentAddress = bridgeService.getCurrentAddress();

  // 加载数据
  const fetchData = useCallback(async () => {
    try {
      const [fetchedParams, fetchedLimits, fetchedHistory] = await Promise.all([
        bridgeService.getBridgeParams(),
        bridgeService.getBridgeLimits(currentAddress),
        bridgeService.getBridgeHistory(currentAddress),
      ]);
      setParams(fetchedParams);
      setLimits(fetchedLimits);
      setRecords(fetchedHistory.list);
      setAddressBook(bridgeService.getAddressBook());
      setBalanceAtos(bridgeService.getUserBalanceAtos());
      setBalanceErc20(bridgeService.getUserBalanceErc20());

      // 如果当前正打开某个交易弹窗，更新其状态
      if (activeRecord) {
        const updated = fetchedHistory.list.find((r) => r.id === activeRecord.id);
        if (updated) {
          setActiveRecord(updated);
        }
      }
    } catch {
      // ignore
    }
  }, [currentAddress, activeRecord]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2500);
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
        sender: bridgeService.getCurrentEthAddress(),
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
      {/* 居中移动端卡片容器（375–420px 优先） */}
      <div className="w-full max-w-[420px] bg-white min-h-screen sm:min-h-0 sm:rounded-2xl shadow-2xl border border-gray-200 flex flex-col relative overflow-hidden">
        {/* 顶部导航与方向切换 */}
        <Header
          currentAddress={currentAddress}
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

        {/* 主体内容 */}
        <main className="p-6 space-y-4 flex-1">
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
