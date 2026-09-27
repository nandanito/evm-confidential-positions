/**
 * The off-chain position book: what each desk SHOULD hold after the moves the walkthrough
 * made. The ledger (as reported by each desk's own node) is authoritative; the book is a
 * prediction that reconciliation (§5) confirms or refutes loudly.
 */
export class Book {
  private readonly balances = new Map<string, bigint>();
  private minted = 0n;

  mint(to: string, amount: number): void {
    this.minted += BigInt(amount);
    this.credit(to, amount);
  }

  move(from: string, to: string, amount: number): void {
    const have = this.balances.get(from) ?? 0n;
    if (have < BigInt(amount)) throw new Error(`book: ${from} holds ${have}, cannot move ${amount}`);
    this.balances.set(from, have - BigInt(amount));
    this.credit(to, amount);
  }

  private credit(to: string, amount: number): void {
    this.balances.set(to, (this.balances.get(to) ?? 0n) + BigInt(amount));
  }

  expected(desk: string): bigint {
    return this.balances.get(desk) ?? 0n;
  }

  get totalMinted(): bigint {
    return this.minted;
  }

  desks(): string[] {
    return [...this.balances.keys()];
  }
}
