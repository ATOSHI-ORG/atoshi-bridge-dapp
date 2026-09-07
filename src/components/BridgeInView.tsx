import React, { useState, useMemo } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { BridgeParams, AddressBookItem } from '../types';
import {
  isValidAtoshiAddress,
  formatNumber,
} from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface BridgeInViewProps {
  /**
   * 钱包连上了吗。
   *
   * 提交按钮原来不看这一项，所以没连钱包也能点 —— 而 mock 模式下点了还会
   * 「成功」。发起跨链必须签名，没有钱包连什么都做不了。
   */
  isConnected: boolean;
  params: BridgeParams | null;
  userErc20Balance: number;
  currentAtoshiAddress: string;
  recipientAtoshi: string;
  onRecipientAtoshiChange: (val: string) => void;
  addressBook: AddressBookItem[];
  isSubmitting: boolean;
  onSubmit: (amountErc20: number, recipientAtoshi: string) => Promise<void>;
  onOpenAddressBook: () => void;
  onOpenFAQ: () => void;
}

export const BridgeInView: React.FC<BridgeInViewProps> = ({
  params,
  userErc20Balance,
  currentAtoshiAddress,
  recipientAtoshi,
  onRecipientAtoshiChange,
  addressBook,
  isSubmitting,
  isConnected,
  onSubmit,
  onOpenAddressBook,
  onOpenFAQ,
}) => {
  const { t } = useI18n();
  const [amountErc20Str, setAmountErc20Str] = useState<string>('500');
  const [isDisclaimerChecked, setIsDisclaimerChecked] = useState<boolean>(true);

  const amountErc20Num = parseFloat(amountErc20Str) || 0;

  // 计算将获得的 Atoshi 主网原生 ATOS 数量（输入 × 100）
  const willReceiveAtos = useMemo(() => {
    if (!amountErc20Num || isNaN(amountErc20Num) || amountErc20Num < 0) return 0;
    return amountErc20Num * 100;
  }, [amountErc20Num]);

  // Atoshi bech32 地址校验
  const isAtoshiAddressValid = isValidAtoshiAddress(recipientAtoshi);

  // 余额校验
  const isBalanceEnough = amountErc20Num > 0 && amountErc20Num <= userErc20Balance;

  const handleSetMax = () => {
    setAmountErc20Str(String(userErc20Balance));
  };


  const canSubmit =
    !isSubmitting &&
    isConnected &&
    params?.bridge_enabled &&
    amountErc20Num > 0 &&
    isBalanceEnough &&
    isAtoshiAddressValid &&
    isDisclaimerChecked;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(amountErc20Num, recipientAtoshi.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 lg:mx-auto lg:max-w-[560px]">
      {/* 1. 金额输入与余额卡片 */}
      <div className="mt-2">
        <div className="flex justify-between items-end mb-2">
          <label htmlFor="input-amount-erc20" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_in.lock_label')}
          </label>
          <span className="text-xs text-gray-400">
            {t('bridge_in.balance')} <span className="font-mono text-gray-700 font-semibold">{formatNumber(userErc20Balance)}</span>
          </span>
        </div>

        {/* 主输入框与“最大”按钮 */}
        <div className="relative">
          <input
            id="input-amount-erc20"
            type="number"
            value={amountErc20Str}
            onChange={(e) => setAmountErc20Str(e.target.value)}
            placeholder="0"
            min="1"
            step="1"
            className="w-full text-2xl sm:text-3xl font-mono border-b-2 border-gray-200 py-2.5 focus:outline-none focus:border-black transition-colors pr-18 text-black placeholder:text-gray-300 font-bold"
          />
          <button
            type="button"
            id="btn-set-max-erc20"
            onClick={handleSetMax}
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-100 hover:bg-gray-200 text-xs font-bold px-3 py-1.5 rounded-md text-gray-800 transition-colors"
          >
            {t('bridge_in.max')}
          </button>
        </div>

        {/* 余额不足错误提示 */}
        {amountErc20Num > userErc20Balance && (
          <p className="text-[11px] text-rose-600 font-medium mt-1">
            {t('bridge_in.insufficient_balance')}
          </p>
        )}

        {/* 换算将收到的 ATOS 数量 */}
        <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>{t('bridge_in.receive_label')}</span>
          <div className="text-right">
            <span className="font-mono text-sm font-bold text-black">
              {formatNumber(willReceiveAtos)}
            </span>
            <span className="font-mono text-[11px] font-semibold text-gray-500 ml-1">{t('bridge_in.atos_unit')}</span>
          </div>
        </div>
      </div>

      {/* 2. 桥入特性与无限流规则卡片 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <span>{t('bridge_in.rules_title')}</span>
          </span>
          <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded">
            {t('bridge_in.rules_badge')}
          </span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          {t('bridge_in.rules_desc')}
        </p>

        {/* 流动性保障说明 */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
          <div className="flex items-center justify-between font-bold text-gray-800 text-[11px]">
            <span className="flex items-center gap-1">
              <span>{t('bridge_in.queue_title')}</span>
            </span>
            <button
              type="button"
              onClick={onOpenFAQ}
              className="text-black hover:underline font-bold text-[10px] flex items-center gap-0.5"
            >
              <span>{t('bridge_in.faq_link')}</span>
              <HelpCircle className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            {t('bridge_in.queue_desc')}
          </p>
        </div>
      </div>

      {/* 3. 中间方向转换示意分割线 */}
      <div className="flex items-center justify-center py-1">
        <div className="h-[1px] bg-gray-200 flex-1"></div>
        <div className="mx-4 bg-gray-100 rounded-full p-2 text-gray-500">
          <ArrowRight className="w-4 h-4" />
        </div>
        <div className="h-[1px] bg-gray-200 flex-1"></div>
      </div>

      {/* 4. 收款 Atoshi 地址输入卡片 */}
      <div className="space-y-2">
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="input-recipient-atoshi" className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t('bridge_in.recipient_label')}
          </label>
        </div>

        <div>
          <input
            id="input-recipient-atoshi"
            type="text"
            value={recipientAtoshi}
            onChange={(e) => onRecipientAtoshiChange(e.target.value)}
            placeholder={t('bridge_in.recipient_placeholder')}
            className={`w-full text-xs sm:text-sm font-mono border bg-gray-50 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all ${
              recipientAtoshi && !isAtoshiAddressValid
                ? 'border-rose-300 focus:ring-rose-500'
                : 'border-gray-200'
            }`}
          />

          {recipientAtoshi && !isAtoshiAddressValid && (
            <p className="text-[11px] text-rose-600 mt-1 font-medium">
              {t('bridge_in.invalid_addr')}
            </p>
          )}
        </div>

        {/* 必选确认 */}
        <div className="p-3.5 bg-blue-50/60 rounded-lg border border-blue-100">
          <label
            htmlFor="checkbox-atoshi-ownership"
            className="flex items-start cursor-pointer select-none text-xs text-blue-800 leading-relaxed"
          >
            <input
              id="checkbox-atoshi-ownership"
              type="checkbox"
              checked={isDisclaimerChecked}
              onChange={(e) => setIsDisclaimerChecked(e.target.checked)}
              className="mt-0.5 mr-2.5 w-4 h-4 rounded text-black focus:ring-black border-gray-300"
            />
            <span>{t('bridge_in.disclaimer')}</span>
          </label>
        </div>
      </div>

      {/* 5. 提交按钮 */}
      <div className="pt-2">
        <button
          type="submit"
          id="btn-submit-bridge-in"
          disabled={!canSubmit}
          className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 ${
            canSubmit
              ? 'bg-black text-white hover:opacity-90 active:scale-[0.98] shadow-md cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              <span>{t('bridge_in.btn_submitting')}</span>
            </>
          ) : !isConnected ? (
            <span>{t('common.connect_wallet_first')}</span>
          ) : !params?.bridge_enabled ? (
            <span>{t('bridge_in.btn_maint')}</span>
          ) : !amountErc20Num || amountErc20Num <= 0 ? (
            <span>{t('bridge_in.btn_enter_amount')}</span>
          ) : !isBalanceEnough ? (
            <span>{t('bridge_in.btn_insufficient')}</span>
          ) : !isAtoshiAddressValid ? (
            <span>{t('bridge_in.btn_invalid_addr')}</span>
          ) : !isDisclaimerChecked ? (
            <span>{t('bridge_in.btn_check_disclaimer')}</span>
          ) : (
            <>
              <span>{t('bridge_in.btn_submit')}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <p className="text-center text-[10px] text-gray-400 mt-2 font-mono">
          {t('bridge_in.security_note')}
        </p>
      </div>
    </form>
  );
};

