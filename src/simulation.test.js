import { describe, it, expect } from 'vitest';
import { amortizingPayment, impliedRemainingTerm, simulate, standaloneLoanCost } from './simulation.js';

// [months, rate%, fee?] tuples → ratePeriods
const fix = list => list.map(([months, rate, fee = 0]) => ({ months, rate: rate / 100, fee }));

const base = {
    principal: 200000,
    termYears: 25,
    ratePeriods: fix([[24, 5]]),
    overpaymentMode: 'reduceTerm',
};
const baseContractual = amortizingPayment(200000, 0.05 / 12, 300);

function totalPaid(result) {
    return result.schedule.reduce((sum, row) => sum + row.payment, 0);
}

describe('amortizingPayment', () => {
    it('matches the standard amortization formula', () => {
        // Textbook value: £100,000 at 5% over 30 years
        expect(amortizingPayment(100000, 0.05 / 12, 360)).toBeCloseTo(536.82, 2);
    });

    it('splits the principal evenly at a zero rate', () => {
        expect(amortizingPayment(12000, 0, 12)).toBeCloseTo(1000, 10);
    });
});

describe('impliedRemainingTerm', () => {
    it('inverts amortizingPayment', () => {
        const payment = amortizingPayment(200000, 0.04 / 12, 300);
        expect(impliedRemainingTerm(200000, 0.04 / 12, payment)).toBeCloseTo(300, 4);
    });

    it('is Infinity when the payment only covers interest', () => {
        expect(impliedRemainingTerm(100000, 0.05 / 12, (100000 * 0.05) / 12)).toBe(Infinity);
    });
});

describe('standaloneLoanCost', () => {
    it('matches the textbook amortizing loan cost', () => {
        // £10,000 at 10% APR over 5 years
        const { monthlyPayment, totalInterest } = standaloneLoanCost(10000, 0.10, 5);
        expect(monthlyPayment).toBeCloseTo(212.47, 2);
        expect(totalInterest).toBeCloseTo(2748.23, 1);
    });
});

describe('simulate', () => {
    it('pays off exactly at term when paying exactly the contractual payment', () => {
        for (const overpaymentMode of ['reduceTerm', 'reducePayment']) {
            const r = simulate({ ...base, overpaymentMode, paymentAmount: baseContractual });
            expect(r.months).toBe(300);
            expect(r.totalOverpayments).toBeCloseTo(0, 4);
            expect(r.schedule.at(-1).balance).toBe(0);
            expect(r.capHit).toBe(false);
        }
    });

    it('conserves money: total paid minus interest equals the principal', () => {
        for (const overpaymentMode of ['reduceTerm', 'reducePayment']) {
            const r = simulate({ ...base, overpaymentMode, paymentAmount: 2000 });
            expect(totalPaid(r) - r.totalInterest).toBeCloseTo(base.principal, 4);
            expect(Math.min(...r.schedule.map(row => row.balance))).toBeGreaterThanOrEqual(0);
        }
    });

    it('shortens the term when overpaying in reduceTerm mode, more so with bigger payments', () => {
        const some = simulate({ ...base, paymentAmount: 1500 });
        const more = simulate({ ...base, paymentAmount: 2000 });
        expect(some.months).toBeLessThan(300);
        expect(more.months).toBeLessThan(some.months);
        expect(more.totalInterest).toBeLessThan(some.totalInterest);
    });

    it('reducePayment holds the end date and costs more interest than reduceTerm', () => {
        const reduceTerm = simulate({ ...base, paymentAmount: 1500 });
        const reducePayment = simulate({ ...base, overpaymentMode: 'reducePayment', paymentAmount: 1500 });
        expect(reducePayment.months).toBeGreaterThan(reduceTerm.months);
        expect(reducePayment.totalInterest).toBeGreaterThan(reduceTerm.totalInterest);
        // The contractual payment must drop at a recalculation event
        expect(reducePayment.schedule[24].contractual).toBeLessThan(reducePayment.schedule[23].contractual);
    });

    it('caps overpayments at 10% of the balance at the start of each year', () => {
        const r = simulate({ ...base, paymentAmount: 5000 });
        expect(r.capHit).toBe(true);
        const firstYearOverpaid = r.schedule
            .slice(0, 12)
            .reduce((sum, row) => sum + (row.payment - row.contractual), 0);
        expect(firstYearOverpaid).toBeCloseTo(base.principal * 0.10, 4);
    });

    it('never lets the final payment overshoot the balance', () => {
        const r = simulate({ ...base, paymentAmount: 1500 });
        const last = r.schedule.at(-1);
        expect(last.balance).toBe(0);
        expect(last.payment).toBeLessThanOrEqual(1500 + 1e-9);
    });

    it('enforces and flags payments below the contractual payment', () => {
        const r = simulate({ ...base, paymentAmount: 500 });
        expect(r.paymentBelowContractual).toBe(true);
        expect(r.months).toBe(300);
        expect(r.totalOverpayments).toBeCloseTo(0, 6);
        for (const row of r.schedule) {
            expect(row.payment).toBeCloseTo(row.contractual, 6);
        }
    });

    it('carries the last rate forward past the end of the schedule', () => {
        const short = simulate({ ...base, ratePeriods: fix([[24, 5], [24, 3]]), paymentAmount: 1500 });
        const padded = simulate({
            ...base,
            ratePeriods: fix([[24, 5], ...Array.from({ length: 12 }, () => [24, 3])]),
            paymentAmount: 1500,
        });
        expect(short.months).toBe(padded.months);
        expect(short.totalInterest).toBeCloseTo(padded.totalInterest, 6);
    });

    it('honours per-line fix durations', () => {
        const twoYear = simulate({ ...base, ratePeriods: fix([[24, 5], [24, 3]]), paymentAmount: 1500 });
        const fiveYear = simulate({ ...base, ratePeriods: fix([[60, 5], [60, 3]]), paymentAmount: 1500 });
        // The rate drop lands at month 25 for a 24-month fix but only at month 61 for a 60-month fix
        expect(twoYear.schedule[24].interest).toBeLessThan(twoYear.schedule[23].interest * 0.99);
        expect(fiveYear.schedule[24].interest).toBeGreaterThan(fiveYear.schedule[23].interest * 0.99);
        expect(fiveYear.schedule[60].interest).toBeLessThan(fiveYear.schedule[59].interest * 0.9);
        // Longer at the higher initial rate costs more overall
        expect(fiveYear.totalInterest).toBeGreaterThan(twoYear.totalInterest);
    });

    it('rolls the product fee into the loan at the start of its fix', () => {
        const noFee = simulate({ ...base, paymentAmount: 1500 });
        const withFee = simulate({ ...base, ratePeriods: fix([[24, 5, 999]]), paymentAmount: 1500 });
        // Entered once, charged once — carried-forward repeats are fee-free
        expect(withFee.totalFees).toBe(999);
        expect(withFee.initialContractualPayment).toBeGreaterThan(noFee.initialContractualPayment);
        expect(withFee.totalInterest).toBeGreaterThan(noFee.totalInterest);
        expect(totalPaid(withFee) - withFee.totalInterest).toBeCloseTo(base.principal + 999, 4);
    });

    it('adds a later fix fee to the balance at that boundary', () => {
        const r = simulate({ ...base, ratePeriods: fix([[24, 5, 0], [24, 4, 500]]), paymentAmount: 1500 });
        expect(r.totalFees).toBe(500);
        const prev = r.schedule[23];
        const row = r.schedule[24];
        expect(row.balance).toBeCloseTo(prev.balance + 500 - (row.payment - row.interest), 6);
        expect(totalPaid(r) - r.totalInterest).toBeCloseTo(base.principal + 500, 4);
    });

    it('repays in full at the end of the chosen fixed period', () => {
        const r = simulate({ ...base, paymentAmount: 1500, fullRepaymentMonth: 48 });
        expect(r.months).toBe(48);
        expect(r.schedule.length).toBe(48);
        expect(r.fullRepayment.month).toBe(48);
        expect(r.fullRepayment.amount).toBeGreaterThan(0);
        expect(r.fullRepayment.amount).toBeCloseTo(r.schedule.at(-1).balance, 10);
        // Conservation now includes the lump sum
        expect(totalPaid(r) + r.fullRepayment.amount - r.totalInterest).toBeCloseTo(base.principal, 4);
        const natural = simulate({ ...base, paymentAmount: 1500 });
        expect(r.totalInterest).toBeLessThan(natural.totalInterest);
    });

    it('does not restrict the lump repayment by the 10% cap', () => {
        const r = simulate({ ...base, paymentAmount: 1500, fullRepaymentMonth: 24 });
        // The lump is far larger than the annual cap and is not counted as an overpayment
        expect(r.fullRepayment.amount).toBeGreaterThan(base.principal * 0.10);
        const monthlyOverpaid = r.schedule.reduce((sum, row) => sum + (row.payment - row.contractual), 0);
        expect(r.totalOverpayments).toBeCloseTo(monthlyOverpaid, 6);
    });

    it('ignores a planned repayment after the natural payoff', () => {
        const natural = simulate({ ...base, paymentAmount: 2000 });
        const r = simulate({ ...base, paymentAmount: 2000, fullRepaymentMonth: natural.months + 24 });
        expect(r.fullRepayment).toBeNull();
        expect(r.months).toBe(natural.months);
        expect(r.totalInterest).toBeCloseTo(natural.totalInterest, 8);
    });

    it('applies a time-limited extra payment only while it runs', () => {
        const plain = simulate({ ...base, paymentAmount: 1500 });
        const boosted = simulate({ ...base, paymentAmount: 1500, extraPayment: { monthlyAmount: 400, months: 60 } });
        expect(boosted.schedule[0].payment).toBeCloseTo(plain.schedule[0].payment + 400, 6);
        expect(boosted.schedule[60].payment).toBeLessThan(boosted.schedule[59].payment);
        expect(boosted.totalInterest).toBeLessThan(plain.totalInterest);
        expect(boosted.months).toBeLessThanOrEqual(plain.months);
    });

    it('keeps the payment level across rate changes in reduceTerm mode when rates are flat', () => {
        const r = simulate({ ...base, paymentAmount: 1500 });
        // With a single flat rate, a reduceTerm recalculation should not move
        // the contractual payment by more than rounding the horizon to whole months
        const c0 = r.schedule[0].contractual;
        const c24 = r.schedule[24].contractual;
        expect(Math.abs(c24 - c0) / c0).toBeLessThan(0.01);
    });
});
