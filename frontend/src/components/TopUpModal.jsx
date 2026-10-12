import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

const PRESETS = [500, 1000, 2000, 5000];

// Posts a signed form to PayHere's hosted checkout page (PayHere requires a form POST, not a redirect).
const postToCheckout = ({ url, fields }) => {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
};

// Collects an amount and sends the Passenger to PayHere to pay.
const TopUpModal = ({ onClose }) => {
  const [config, setConfig] = useState(null);
  const [amount, setAmount] = useState('1000');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.get('/api/topups/config')
      .then((res) => {
        setConfig(res.data);
        if (res.data.min && Number(amount) < res.data.min) setAmount(String(res.data.min));
      })
      .catch(() => setError('Could not load top-up options. Please try again.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const min = config?.min ?? 500;
  const max = config?.max ?? 50000;
  const unavailable = config && !config.available;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting || unavailable) return;
    const value = Number(amount);
    if (!Number.isInteger(value)) return setError('Enter a whole number of rupees.');
    if (value < min || value > max) return setError(`Amount must be between Rs. ${min} and Rs. ${max}.`);

    setError('');
    setIsSubmitting(true);
    try {
      const res = await api.post('/api/topups', { amount: value });
      // Stays disabled: the browser is leaving for PayHere.
      postToCheckout(res.data.checkout);
    } catch (err) {
      setError(errorMessage(err, 'Could not start the payment. Please try again.'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm p-6 space-y-4 modal-max-h overflow-y-auto"
      >
        <h2 className="text-lg font-bold outfit text-slate-900">Top up balance</h2>
        <p className="text-xs text-slate-500">You will be taken to PayHere to pay securely. Balance is added once payment is confirmed.</p>

        {unavailable && (
          <div className="p-2 border-l-2 bg-red-50 border-red-500 text-red-600 text-xs font-medium">
            Online payments are unavailable right now.
          </div>
        )}
        {error && !unavailable && (
          <div className="p-2 border-l-2 bg-red-50 border-red-500 text-red-600 text-xs font-medium">{error}</div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {PRESETS.filter((p) => p >= min && p <= max).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setAmount(String(p))}
              className={`py-2 text-sm font-semibold rounded-sm border transition-colors ${Number(amount) === p ? 'border-rail-blue bg-rail-blue/10 text-rail-blue' : 'border-slate-200 text-slate-600 hover:border-rail-blue'}`}
            >
              {p}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Amount (Rs.)</label>
          <input
            type="number" inputMode="numeric" step="1" min={min} max={max} required
            className="input-field py-2.5 text-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-[10px] text-slate-400 mt-1">Minimum Rs. {min}, maximum Rs. {max}.</p>
        </div>

        <div className="flex flex-wrap gap-3 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900 font-medium px-3">Close</button>
          <button type="submit" disabled={isSubmitting || unavailable || !config} className="btn-primary py-2 px-4 text-sm disabled:opacity-50">
            {isSubmitting ? 'Redirecting...' : 'Pay with PayHere'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TopUpModal;
