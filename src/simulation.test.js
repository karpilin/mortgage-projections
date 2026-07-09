import { describe, it, expect } from 'vitest';
import { amortizingPayment, impliedRemainingTerm, simulate } from './simulation.js';

const pct = rates => rates.map(r => r / 100);

const base = {
    principal: 200000,
    termYears: 25,
    annualRates: pct([5]),
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
            expect(row.payment).toBeGreaterThanOrEqual(Math.min(row.contractual, row.payment));
            expect(row.payment).toBeCloseTo(row.contractual, 6);
        }
    });

    it('carries the last rate forward past the end of the schedule', () => {
        const short = simulate({ ...base, annualRates: pct([5, 3]), paymentAmount: 1500 });
        const padded = simulate({ ...base, annualRates: pct([5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), paymentAmount: 1500 });
        expect(short.months).toBe(padded.months);
        expect(short.totalInterest).toBeCloseTo(padded.totalInterest, 6);
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

    it('keeps the payment level across rate changes in reduceTerm mode when rates are flat', () => {
        const r = simulate({ ...base, paymentAmount: 1500 });
        // With a single flat rate, a reduceTerm recalculation should not move
        // the contractual payment by more than rounding the horizon to whole months
        const c0 = r.schedule[0].contractual;
        const c24 = r.schedule[24].contractual;
        expect(Math.abs(c24 - c0) / c0).toBeLessThan(0.01);
    });
});
