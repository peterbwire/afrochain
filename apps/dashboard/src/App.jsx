import { useEffect, useState } from 'react';

import { AfroChainClient, formatUnits } from '@afrochain/sdk';

const client = new AfroChainClient({
  baseUrl: import.meta.env.VITE_AFROCHAIN_API || 'http://localhost:4100',
  operatorToken: import.meta.env.VITE_AFROCHAIN_OPERATOR_TOKEN || null
});

function formatAfc(value) {
  return Number(formatUnits(value || 0)).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

export default function App() {
  const [chain, setChain] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [treasury, setTreasury] = useState(null);
  const [network, setNetwork] = useState(null);
  const [faucet, setFaucet] = useState(null);
  const [validators, setValidators] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [status, setStatus] = useState('Loading AfroChain network dashboard...');

  async function refresh() {
    try {
      const [nextChain, nextMetrics, nextTreasury, nextNetwork, nextFaucet, nextValidators, nextContracts, nextProposals] =
        await Promise.all([
          client.getChain(),
          client.getMetrics(),
          client.getTreasury(),
          client.getNetwork(),
          client.getFaucet(),
          client.getValidators(),
          client.getContracts(),
          client.getProposals()
        ]);

      setChain(nextChain);
      setMetrics(nextMetrics);
      setTreasury(nextTreasury);
      setNetwork(nextNetwork);
      setFaucet(nextFaucet);
      setValidators(nextValidators);
      setContracts(nextContracts);
      setProposals(nextProposals);
      setStatus('Live chain telemetry connected.');
    } catch (error) {
      setStatus(`Dashboard waiting for node: ${error.message}`);
    }
  }

  useEffect(() => {
    refresh();
    const intervalId = setInterval(refresh, 12000);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AfroChain Dashboard</p>
          <h1>A Layer 1 for affordable African payments, durable node operations, and community-owned growth.</h1>
          <p className="lede">
            AfroChain now exposes operational persistence, faucet bootstrap, treasury analytics, peer topology, and
            developer simulation flows on top of the original PoS, contract, and governance platform.
          </p>
        </div>
        <div className="hero-panel">
          <span className="status-pill">{status}</span>
          <div className="stat-row">
            <span>Network</span>
            <strong>{chain?.network || 'devnet'}</strong>
          </div>
          <div className="stat-row">
            <span>Chain Height</span>
            <strong>{chain?.height ?? '-'}</strong>
          </div>
          <div className="stat-row">
            <span>Snapshot Backing</span>
            <strong>{chain?.snapshotPath ? 'enabled' : 'off'}</strong>
          </div>
        </div>
      </section>

      <section className="spotlight-grid">
        <article className="spotlight-card warm">
          <span>Total Staked</span>
          <strong>{formatAfc(chain?.totalStaked)}</strong>
          <p>Community stake securing the chain across African validator hubs.</p>
        </article>
        <article className="spotlight-card cool">
          <span>Cross-Border Volume</span>
          <strong>{formatAfc(metrics?.crossBorderVolume)}</strong>
          <p>Tracked flow across remittance corridors and merchant settlement paths.</p>
        </article>
        <article className="spotlight-card bright">
          <span>Faucet Balance</span>
          <strong>{formatAfc(chain?.faucetBalance)}</strong>
          <p>Developer and mobile-user bootstrap funds available through the node API.</p>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Protocol priorities</p>
              <h2>Why AfroChain</h2>
            </div>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <h3>Low fees by default</h3>
              <p>Small base fees, fee burn, and relayer subsidies keep everyday transfers accessible.</p>
            </article>
            <article className="feature-card">
              <h3>Mobile-first distribution</h3>
              <p>Faucet support and compact wallet flows help onboard users without heavy desktop tooling.</p>
            </article>
            <article className="feature-card">
              <h3>Durable nodes</h3>
              <p>Snapshot import/export and persistent state make local validators and public nodes easier to operate.</p>
            </article>
            <article className="feature-card">
              <h3>Composable contracts</h3>
              <p>AfroCoin, savings circles, and escrow templates give remittance and savings dApps a real launchpad.</p>
            </article>
          </div>
        </div>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">SDK quick start</p>
              <h2>Developer flows</h2>
            </div>
          </div>
          <pre className="code-card">{`import { AfroChainClient, createWallet } from '@afrochain/sdk';

const client = new AfroChainClient({
  baseUrl: 'http://localhost:4100',
  operatorToken: import.meta.env.VITE_AFROCHAIN_OPERATOR_TOKEN || null
});
const wallet = await createWallet();

await client.requestFaucet(wallet.address, 500_000_000);
const preview = await client.signAndSimulate(wallet, {
  type: 'payment',
  fee: 500,
  payload: {
    recipient: 'afc_settlement_hub',
    amount: 25_000_000,
    originCountry: 'Kenya',
    destinationCountry: 'Nigeria',
    mobileMoneyProvider: 'M-Pesa'
  }
});`}</pre>
          <div className="developer-points">
            <span>Wallet creation</span>
            <span>Signed simulation</span>
            <span>Faucet bootstrap</span>
            <span>Snapshot export</span>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Treasury</p>
              <h2>Reserves and liabilities</h2>
            </div>
          </div>
          <div className="list">
            {(treasury?.topTreasuryAccounts || []).slice(0, 5).map((account) => (
              <article className="list-card" key={account.address}>
                <div>
                  <h3>{account.label}</h3>
                  <p>{account.type}</p>
                </div>
                <span>{formatAfc(account.balance)} AFC</span>
              </article>
            ))}
            <article className="proposal-card">
              <div>
                <h3>Pending liabilities</h3>
                <p>{formatAfc(treasury?.rewardLiabilities)} AFC in reward balances</p>
              </div>
              <span>{formatAfc(treasury?.pendingWithdrawalTotal)} AFC</span>
            </article>
          </div>
        </div>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Operators</p>
              <h2>Node topology</h2>
            </div>
          </div>
          <div className="list">
            {(network?.peers || []).map((peer) => (
              <article className="list-card" key={peer.url}>
                <div>
                  <h3>{peer.label || peer.url}</h3>
                  <p>{peer.region || 'Unknown region'}</p>
                </div>
                <span>{peer.status}</span>
              </article>
            ))}
            <article className="proposal-card">
              <div>
                <h3>Snapshot persistence</h3>
                <p>{network?.node?.snapshotPath || 'No snapshot file configured'}</p>
              </div>
              <span>{network?.lastPersistedAt ? 'live' : 'new'}</span>
            </article>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Validators & Contracts</p>
              <h2>Security and builders</h2>
            </div>
          </div>
          <div className="list">
            {validators.slice(0, 5).map((validator) => (
              <article className="list-card" key={validator.address}>
                <div>
                  <h3>{validator.name}</h3>
                  <p>
                    {validator.region} • {formatAfc(validator.totalStake)} AFC secured
                  </p>
                </div>
                <span>{Math.round(validator.commissionRate * 100)}%</span>
              </article>
            ))}
            {contracts.slice(0, 4).map((contract) => (
              <article className="list-card" key={contract.address}>
                <div>
                  <h3>{contract.name}</h3>
                  <p>{contract.template}</p>
                </div>
                <span>{formatAfc(contract.balance)} AFC</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Governance & Onboarding</p>
              <h2>Community coordination</h2>
            </div>
          </div>
          <div className="list">
            {proposals.length ? (
              proposals.map((proposal) => (
                <article className="proposal-card" key={proposal.id}>
                  <div>
                    <h3>{proposal.title}</h3>
                    <p>{proposal.summary}</p>
                  </div>
                  <span>{proposal.status}</span>
                </article>
              ))
            ) : (
              <article className="proposal-card empty">
                <div>
                  <h3>DAO ready</h3>
                  <p>Publish the first proposal from the wallet to activate live governance history here.</p>
                </div>
                <span>waiting</span>
              </article>
            )}
            {(faucet?.recentDisbursements || []).slice(0, 3).map((entry) => (
              <article className="list-card" key={entry.id}>
                <div>
                  <h3>{entry.label || entry.address}</h3>
                  <p>{entry.note}</p>
                </div>
                <span>{formatAfc(entry.amount)} AFC</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
