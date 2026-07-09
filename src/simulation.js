// Pure simulation logic — no DOM access, so it can be unit tested.
//
// Model: the lender sets a contractual monthly payment that stays fixed
// within each fixed-rate period and is recalculated at every rate change.
// Overpayments are measured against the contractual payment and capped at
// 10% of the balance as it stood at the start of each year. What a rate-change
// recalculation targets depends on the overpayment mode:
//   - 'reduceTerm':    keep the payment level; overpayments shorten the loan.
//   - 'reducePayment': keep the original end date; the payment drops instead.

const CAP_RATE = 0.10;

/**
 * Standard amortizing payment: clears `principal` in `numberOfMonths`
 * equal payments at `monthlyRate`.
 */
export function amortizingPayment(principal, monthlyRate, numberOfMonths) {
    if (principal <= 0) return 0;
    if (numberOfMonths <= 0) return principal;
    if (monthlyRate <= 0) return principal / numberOfMonths;
    const factor = Math.pow(1 + monthlyRate, numberOfMonths);
    if (!isFinite(factor)) return principal;
    return principal * (monthlyRate * factor) / (factor - 1);
}

/**
 * Inverse of amortizingPayment: how many months of `payment` at
 * `monthlyRate` it takes to clear `balance`. Infinity if the payment
 * doesn't cover the interest.
 */
export function impliedRemainingTerm(balance, monthlyRate, payment) {
    if (balance <= 0) return 0;
    if (monthlyRate <= 0) return balance / payment;
    if (payment <= balance * monthlyRate) return Infinity;
    return Math.log(payment / (payment - balance * monthlyRate)) / Math.log(1 + monthlyRate);
}

/**
 * Cost of borrowing `amount` as a standalone amortizing loan (car loan,
 * personal loan) — the benchmark that mortgage consolidation is compared to.
 */
export function standaloneLoanCost(amount, annualRate, termYears) {
    const months = termYears * 12;
    const monthlyPayment = amortizingPayment(amount, annualRate / 12, months);
    return { monthlyPayment, totalInterest: monthlyPayment * months - amount };
}

/**
 * Runs the month-by-month simulation.
 *
 * @param {object} inputs
 * @param {number} inputs.principal
 * @param {number} inputs.termYears
 * @param {number} inputs.paymentAmount - What the borrower actually pays each
 *   month (never less than the contractual payment).
 * @param {number[]} inputs.annualRates - Decimal rates (0.0464 = 4.64%), one
 *   per fixed period; the last one carries forward.
 * @param {'reducePayment'|'reduceTerm'} [inputs.overpaymentMode]
 * @param {number} [inputs.fixYears] - Length of each fixed-rate period in years.
 * @param {{monthlyAmount: number, months: number}|null} [inputs.extraPayment] -
 *   Additional monthly payment applied only for the first `months` months
 *   (e.g. a redirected standalone-loan payment). Still subject to the cap.
 * @param {number|null} [inputs.fullRepaymentMonth] - Month after which the
 *   remaining balance is repaid as a lump sum (the end of a fixed period, so
 *   the 10% cap does not apply to it). Ignored if the loan clears earlier.
 * @returns {{months: number, totalInterest: number, totalOverpayments: number,
 *   initialContractualPayment: number, capHit: boolean,
 *   paymentBelowContractual: boolean,
 *   fullRepayment: {month: number, amount: number}|null,
 *   schedule: Array<{month: number, interest: number, payment: number,
 *   contractual: number, balance: number}>}}
 */
export function simulate({ principal, termYears, paymentAmount, annualRates, overpaymentMode = 'reducePayment', fullRepaymentMonth = null, fixYears = 2, extraPayment = null }) {
    const totalMonths = termYears * 12;
    const fixMonths = fixYears * 12;

    let balance = principal;
    let months = 0;
    let totalInterest = 0;
    let totalOverpayments = 0;
    let contractual = 0;
    let cap = 0;
    let overpaidThisYear = 0;
    let capHit = false;
    let paymentBelowContractual = false;
    let fullRepayment = null;
    const schedule = [];

    const initialContractualPayment = amortizingPayment(principal, annualRates[0] / 12, totalMonths);

    while (balance > 0 && months < totalMonths) {
        const rateIndex = Math.min(Math.floor(months / fixMonths), annualRates.length - 1);
        const monthlyRate = annualRates[rateIndex] / 12;

        if (months === 0) {
            contractual = initialContractualPayment;
        } else if (months % fixMonths === 0) {
            const remainingMonths = totalMonths - months;
            if (overpaymentMode === 'reducePayment') {
                contractual = amortizingPayment(balance, monthlyRate, remainingMonths);
            } else {
                const previousRate = annualRates[Math.min(Math.floor((months - 1) / fixMonths), annualRates.length - 1)] / 12;
                const implied = impliedRemainingTerm(balance, previousRate, contractual);
                // The 1e-6 guards against float noise pushing ceil() up a whole month
                const horizon = isFinite(implied)
                    ? Math.min(remainingMonths, Math.max(1, Math.ceil(implied - 1e-6)))
                    : remainingMonths;
                contractual = amortizingPayment(balance, monthlyRate, horizon);
            }
        }

        if (months % 12 === 0) {
            cap = balance * CAP_RATE;
            overpaidThisYear = 0;
        }

        const interest = balance * monthlyRate;
        const targetPayment = paymentAmount
            + (extraPayment && months < extraPayment.months ? extraPayment.monthlyAmount : 0);
        if (targetPayment < contractual) paymentBelowContractual = true;

        const intendedOverpayment = Math.max(0, targetPayment - contractual);
        let overpayment = Math.min(intendedOverpayment, Math.max(0, cap - overpaidThisYear));
        if (intendedOverpayment > overpayment) capHit = true;

        let payment = contractual + overpayment;
        const payoff = balance + interest;
        // Half-penny tolerance so float residue can't leave a phantom balance
        if (payment >= payoff - 0.005) {
            payment = payoff;
            overpayment = Math.max(0, payment - contractual);
            balance = 0;
        } else {
            balance -= payment - interest;
        }

        totalInterest += interest;
        overpaidThisYear += overpayment;
        totalOverpayments += overpayment;
        months++;
        schedule.push({ month: months, interest, payment, contractual, balance });

        if (fullRepaymentMonth !== null && months >= fullRepaymentMonth && balance > 0) {
            fullRepayment = { month: months, amount: balance };
            balance = 0;
        }
    }

    return {
        months,
        totalInterest,
        totalOverpayments,
        initialContractualPayment,
        capHit,
        paymentBelowContractual,
        fullRepayment,
        schedule,
    };
}
