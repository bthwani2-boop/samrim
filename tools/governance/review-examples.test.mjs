// Illustrative arithmetic ONLY for independent policy review of FIN-01/02/03.
// NOT WLT code, a ledger implementation, a payment simulation or evidence
// of live bookkeeping, provider proof, custody transfer or reviewer sign-off.
import test from 'node:test';
import assert from 'node:assert/strict';

function split(total, wallet, cash) {
  for (const [key, amount] of Object.entries({total,wallet,cash})) {
    if (typeof amount !== 'bigint' || amount < 0n) throw new Error('invalid YER integer ' + key);
  }
  if (total !== wallet + cash) throw new Error('funding allocations do not conserve payable');
  return {total,wallet,cash};
}

test('FIN-01 example: wallet-only order has no Captain physical COD hold', () => {
  const a=split(1000n,1000n,0n);
  assert.equal(a.wallet,1000n);
  assert.equal(a.cash,0n);
  // This is the necessary policy relationship, not a real WLT mutation.
  assert.equal(a.cash,0n);
});
test('FIN-01 example: COD-only eligible Captain exposure is strictly greater than full total', () => {
  const a=split(1000n,0n,1000n);
  assert.equal(1000n > a.total, false, 'equal coverage must be rejected');
  assert.equal(1001n > a.total, true);
  assert.equal(a.cash,1000n);
});
test('FIN-01 example: mixed payable needs full gross coverage, cash-only hold', () => {
  const a=split(1000n,300n,700n);
  assert.equal(1001n > a.total,true);
  assert.equal(a.cash,700n,'only physical cash is eligible for a COD hold');
  assert.notEqual(a.cash,a.total,'wallet amount must not become Captain cash liability');
});
test('FIN-01 example: cancellation before physical collection releases the cash hold', () => {
  const a=split(1000n,300n,700n);
  const previouslyPostedCashCollection=0n;
  const releasedCashHold=a.cash;
  const customerWalletRefund=a.wallet;
  assert.equal(releasedCashHold,700n);
  assert.equal(customerWalletRefund,300n);
  assert.equal(previouslyPostedCashCollection,0n,
    'hold release is not a reverse of a posted cash-collection debit');
});
test('FIN-01 example: invalid or fractional YER split is rejected', () => {
  assert.throws(()=>split(1000n,300n,699n),/conserve payable/);
  assert.throws(()=>split(1000n,-1n,1001n),/invalid YER/);
  assert.throws(()=>split(1000n,300.5,699.5),/invalid YER/);
});
test('FIN-02 example: Store-collected proceeds and platform receivable are different facts', () => {
  const storeCollected=1000n;
  const illustrativeAcceptedCommission=75n; // NOT an approved rate.
  const storeHeldProceeds=storeCollected;
  const platformReceivable=illustrativeAcceptedCommission;
  assert.equal(storeHeldProceeds,1000n);
  assert.equal(platformReceivable,75n);
  // Do not claim Store-collected funds are new WLT Merchant earnings.
  assert.notEqual(platformReceivable,storeHeldProceeds);
});
test('FIN-03 example: verified gross provider funding is distinct from net settlement and fee', () => {
  const gross=1000n,fee=20n,net=980n; // Illustrative; no provider rate assumed.
  assert.equal(gross,net+fee);
  assert.equal(gross,1000n,'beneficiary gross credit is not reduced by fee');
});
test('FIN-03 example: approved zero-product-commission Captain delivery markup is separate', () => {
  const baseCaptainDeliveryEntitlement=500n,additionalPlatformMarkup=100n;
  const customerDeliveryTotal=600n;
  assert.equal(customerDeliveryTotal,baseCaptainDeliveryEntitlement+additionalPlatformMarkup);
  assert.equal(baseCaptainDeliveryEntitlement,500n);
  // Example values do not approve stacking with product commission.
});
