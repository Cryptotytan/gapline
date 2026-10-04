export function cardCheckout(address: string, amount: number) {
  const params = new URLSearchParams({
    crypto: "USDT",
    network: "BSC",
    fiat: "USD",
    fiatAmount: String(Math.max(10, Math.ceil(amount))),
    address,
  });
  window.location.assign(`https://ramp.alchemypay.org/?${params.toString()}`);
}
