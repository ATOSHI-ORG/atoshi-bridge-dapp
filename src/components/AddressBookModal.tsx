import React, { useState } from 'react';
import { X, BookUser, Plus, Check } from 'lucide-react';
import { AddressBookItem } from '../types';
import { isValidEthereumAddress, isValidAtoshiAddress } from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface AddressBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  network: 'ethereum' | 'atoshi';
  addressList: AddressBookItem[];
  onSelectAddress: (addr: string) => void;
  onAddNewAddress: (label: string, address: string, network: 'ethereum' | 'atoshi') => void;
}

export const AddressBookModal: React.FC<AddressBookModalProps> = ({
  isOpen,
  onClose,
  network,
  addressList,
  onSelectAddress,
  onAddNewAddress,
}) => {
  const { t } = useI18n();
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const filteredAddresses = addressList.filter((item) => item.network === network);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newLabel.trim()) {
      setError(t('address_book.err_label'));
      return;
    }

    if (network === 'ethereum' && !isValidEthereumAddress(newAddress)) {
      setError(t('address_book.err_eth'));
      return;
    }

    if (network === 'atoshi' && !isValidAtoshiAddress(newAddress)) {
      setError(t('address_book.err_atos'));
      return;
    }

    onAddNewAddress(newLabel.trim(), newAddress.trim(), network);
    setNewLabel('');
    setNewAddress('');
    setIsAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="address-book-dialog"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
              <BookUser className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {network === 'ethereum' ? t('address_book.title_eth') : t('address_book.title_atos')}
              </h3>
              <p className="text-xs text-gray-500">{t('address_book.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-address-book"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {/* 添加新地址表单 */}
          {isAdding ? (
            <form onSubmit={handleSave} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-gray-800">{t('address_book.add_new_title')}</div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">{t('address_book.label_hint')}</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t('address_book.label_placeholder')}
                  className="w-full px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">
                  {network === 'ethereum' ? t('address_book.addr_hint_eth') : t('address_book.addr_hint_atos')}
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder={network === 'ethereum' ? '0x...' : 'atoshi1...'}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>
              {error && <p className="text-[11px] text-rose-600 font-medium">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="flex-1 py-2 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium"
                >
                  {t('address_book.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs text-white bg-black rounded-lg hover:bg-gray-800 font-bold"
                >
                  {t('address_book.save')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              id="btn-add-address-trigger"
              onClick={() => setIsAdding(true)}
              className="w-full py-2.5 px-3 border border-dashed border-gray-300 rounded-xl text-xs text-black hover:bg-gray-50 flex items-center justify-center gap-1.5 font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t('address_book.add_btn')}</span>
            </button>
          )}

          {/* 地址列表 */}
          <div className="space-y-2 pt-1">
            {filteredAddresses.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs">
                {t('address_book.empty')}
              </div>
            ) : (
              filteredAddresses.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectAddress(item.address);
                    onClose();
                  }}
                  className="group p-3 bg-white border border-gray-200 hover:border-black hover:bg-gray-50 rounded-xl transition-all cursor-pointer flex items-center justify-between"
                >
                  <div className="space-y-0.5 overflow-hidden">
                    <div className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
                      <span>{item.label}</span>
                      {item.lastUsedAt && (
                        <span className="text-[10px] text-gray-400 font-normal">
                          {t('address_book.recent')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-gray-500 truncate" title={item.address}>
                      {item.address}
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-gray-100 group-hover:bg-black group-hover:text-white flex items-center justify-center text-gray-400 transition-colors shrink-0 ml-2">
                    <Check className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-xl text-xs transition-colors"
          >
            {t('address_book.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

