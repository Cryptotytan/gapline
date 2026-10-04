import { Kicker, Panel } from "./ui";

const STEPS = [
  {
    n: "1",
    title: "Get a Web3 API key",
    body: "Sign in at the Binance developer portal and create a key. Put the key and secret in a local env file that is not committed. Do not paste the secret into chat.",
    href: "https://web3.binance.com/en/dev-portal",
    label: "Developer portal",
  },
  {
    n: "2",
    title: "Register the hackathon entry",
    body: "The build window closes 11 Oct 2026, 12:00 UTC. Register the team before you spend the weekend on polish.",
    href: "https://forms.gle/NEmy3FxYc4f5Dua47",
    label: "Registration form",
  },
  {
    n: "3",
    title: "Prove one read",
    body: "Call the RWA Data API for a ticker such as NVDA. If the JSON shape differs from this tape, the client has to change. Save the response and redact the key.",
    href: "https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data",
    label: "RWA Data API",
  },
  {
    n: "4",
    title: "Log the weekend yourself",
    body: "This preview is a recorded Saturday tape. A logger has to run on your machine or a small server, because a chat session ends. Start it as soon as the key works. Missed hours are gone.",
    href: "https://web3.binance.com/en/dev-docs/llms-full.txt",
    label: "Full docs for your coding agent",
  },
  {
    n: "5",
    title: "Fork, then simulate, then a few dollars",
    body: "bStocks, Ondo, and xStocks are mainnet instruments. A plain BSC testnet will not have the books. Fork BSC mainnet, dry-run with the Transaction API, then send one small spot swap from a fresh wallet. Keep a size cap and an allowlist.",
    href: "https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api",
    label: "Transaction API",
  },
  {
    n: "6",
    title: "Agent Studio last",
    body: "Install the studio CLI, install the skills, and deploy only after a simulated swap succeeds. The studio gives the agent a wallet and an on-chain identity. It will not fix a bad rule.",
    href: "https://www.bnbchain.org/en/bnb-agent-studio",
    label: "BNB Agent Studio",
  },
];

export function LiveView() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Panel className="p-5 sm:p-6">
        <Kicker>On chain</Kicker>
        <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Go live on BSC</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          A buy is signed in your wallet. A refusal still sends nothing.
        </p>
      </Panel>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step) => (
          <li key={step.n}>
            <Panel className="p-5">
              <p className="font-display text-3xl leading-none text-primary">{step.n}</p>
              <h3 className="mt-2 text-lg text-fg">{step.title}</h3>
              <p className="mt-2 text-sm text-pretty text-muted">{step.body}</p>
              <a href={step.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-11 items-center text-sm text-primary">
                {step.label}
              </a>
            </Panel>
          </li>
        ))}
      </ol>
    </div>
  );
}
