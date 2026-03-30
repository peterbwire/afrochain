import { useEffect, useState } from 'react';

import { AfroChainClient, formatUnits } from '@afrochain/sdk';

const client = new AfroChainClient(import.meta.env.VITE_AFROCHAIN_API || 'http://localhost:4100');

function formatAfc(value) {
  return Number(formatUnits(value || 0)).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

export default function App() {
  const [chain, setChain] = useState(null);
  const [finality, setFinality] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [treasury, setTreasury] = useState(null);
  const [network, setNetwork] = useState(null);
  const [mempool, setMempool] = useState(null);
  const [faucet, setFaucet] = useState(null);
  const [activity, setActivity] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [validators, setValidators] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [lookupAddress, setLookupAddress] = useState('afc_validator_nairobi');
  const [lookupAccount, setLookupAccount] = useState(null);
  const [searchQuery, setSearchQuery] = useState('nairobi');
  const [searchResults, setSearchResults] = useState(null);
  const [status, setStatus] = useState('Connecting to AfroChain explorer node...');

  async function refresh() {
    try {
      const [
        nextChain,
        nextFinality,
        nextMetrics,
        nextTreasury,
        nextNetwork,
        nextMempool,
        nextFaucet,
        nextActivity,
        nextBlocks,
        nextTransactions,
        nextValidators,
        nextContracts,
        nextProposals
      ] = await Promise.all([
        client.getChain(),
        client.getFinality(),
        client.getMetrics(),
        client.getTreasury(),
        client.getNetwork(),
        client.getMempool(8),
        client.getFaucet(),
        client.getActivity(10),
        client.getBlocks(8),
        client.getTransactions(8),
        client.getValidators(),
        client.getContracts(),
        client.getProposals()
      ]);

      setChain(nextChain);
      setFinality(nextFinality);
      setMetrics(nextMetrics);
      setTreasury(nextTreasury);
      setNetwork(nextNetwork);
      setMempool(nextMempool);
      setFaucet(nextFaucet);
      setActivity(nextActivity);
      setBlocks(nextBlocks);
      setTransactions(nextTransactions);
      setValidators(nextValidators);
      setContracts(nextContracts);
      setProposals(nextProposals);
      setStatus('Explorer synced.');
    } catch (error) {
      setStatus(`Explorer offline: ${error.message}`);
    }
  }

  useEffect(() => {
    refresh();
    const intervalId = setInterval(refresh, 10000);
    return () => clearInterval(intervalId);
  }, []);

  async function handleLookup(event) {
    event.preventDefault();

    try {
      const account = await client.getAccount(lookupAddress);
      setLookupAccount(account);
      setStatus('Loaded account details.');
    } catch (error) {
      setStatus(`Lookup failed: ${error.message}`);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();

    try {
      const result = await client.search(searchQuery);
      setSearchResults(result);
      setStatus('Search results loaded.');
    } catch (error) {
      setStatus(`Search failed: ${error.message}`);
    }
  }

  return (
    <main className="explorer-shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">AfroChain Explorer</p>
          <h1>Inspect blocks, treasury flows, peers, mempool pressure, search results, and payment activity in real time.</h1>
        </div>
        <span className="status-pill">{status}</span>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Height</span>
          <strong>{chain?.height ?? '-'}</strong>
        </article>
        <article className="metric-card">
          <span>Finalized Height</span>
          <strong>{finality?.finalizedHeight ?? chain?.finalizedHeight ?? '-'}</strong>
        </article>
        <article className="metric-card">
          <span>Finality Depth</span>
          <strong>{finality?.finalityDepth ?? chain?.finalityDepth ?? '-'}</strong>
        </article>
        <article className="metric-card">
          <span>Active Validators</span>
          <strong>{chain?.activeValidatorCount ?? '-'}</strong>
        </article>
        <article className="metric-card">
          <span>Contract Gas Used</span>
          <strong>{Number(metrics?.totalContractGasUsed || 0).toLocaleString('en-US')}</strong>
        </article>
        <article className="metric-card">
          <span>Treasury Grants</span>
          <strong>{formatAfc(treasury?.treasuryGrantVolume)}</strong>
        </article>
        <article className="metric-card highlight">
          <span>Pending Mempool</span>
          <strong>{mempool?.stats?.size ?? 0}</strong>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Corridors</p>
              <h2>Remittance activity</h2>
            </div>
          </div>
          <div className="corridor-list">
            {(metrics?.corridors || []).slice(0, 4).map((corridor) => (
              <article className="corridor-card" key={corridor.name}>
                <div className="corridor-topline">
                  <h3>{corridor.name}</h3>
                  <span>{formatAfc(corridor.volume)} AFC</span>
                </div>
                <div className="corridor-bar">
                  <div
                    style={{
                      width: `${Math.max(12, Math.min(100, (corridor.volume / Math.max(metrics.corridors[0]?.volume || 1, 1)) * 100))}%`
                    }}
                  />
                </div>
                <p>{corridor.transactions} transfers tracked</p>
              </article>
            ))}
          </div>
        </div>

        <form className="panel stack" onSubmit={handleSearch}>
          <div className="section-header">
            <div>
              <p className="eyebrow">Search</p>
              <h2>Find accounts, validators, txs, and proposals</h2>
            </div>
          </div>
          <label>
            Query
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>
          <button className="primary-button" type="submit">
            Search
          </button>
          <div className="list">
            {(searchResults?.results?.validators || []).slice(0, 2).map((validator) => (
              <article className="list-card" key={validator.address}>
                <div>
                  <h3>{validator.name}</h3>
                  <p>{validator.region}</p>
                </div>
                <span>{formatAfc(validator.totalStake)} AFC</span>
              </article>
            ))}
            {(searchResults?.results?.accounts || []).slice(0, 2).map((account) => (
              <article className="list-card" key={account.address}>
                <div>
                  <h3>{account.label || account.address}</h3>
                  <p>{account.address}</p>
                </div>
                <span>{formatAfc(account.balance)} AFC</span>
              </article>
            ))}
          </div>
        </form>
      </section>

      <section className="content-grid">
        <form className="panel stack" onSubmit={handleLookup}>
          <div className="section-header">
            <div>
              <p className="eyebrow">Account Lookup</p>
              <h2>Inspect any wallet or validator</h2>
            </div>
          </div>
          <label>
            AfroChain Address
            <input value={lookupAddress} onChange={(event) => setLookupAddress(event.target.value)} />
          </label>
          <button className="primary-button" type="submit">
            Lookup Account
          </button>
          {lookupAccount ? (
            <article className="account-card">
              <h3>{lookupAccount.label || lookupAccount.address}</h3>
              <p>Balance: {formatAfc(lookupAccount.balance)} AFC</p>
              <p>Staking power: {formatAfc(lookupAccount.stakingPower)} AFC</p>
              <p>Rewards: {formatAfc(lookupAccount.rewards)} AFC</p>
            </article>
          ) : null}
        </form>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Chain Activity</p>
              <h2>Recent indexed events</h2>
            </div>
          </div>
          <div className="list">
            {activity.map((entry) => (
              <article className="proposal-card" key={entry.id}>
                <div>
                  <h3>{entry.summary}</h3>
                  <p>{entry.corridor || entry.sender}</p>
                  <p>{entry.finalized ? 'Finalized' : 'Awaiting finality'}</p>
                </div>
                <span>
                  {entry.gasUsed ? `${entry.gasUsed} gas` : entry.amount ? `${formatAfc(entry.amount)} AFC` : entry.type}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Blocks</p>
              <h2>Recent production</h2>
            </div>
          </div>
          <div className="list">
            {blocks.map((block) => (
              <article className="list-card" key={block.hash}>
                <div>
                  <h3>Block #{block.height}</h3>
                  <p>{block.transactions.length} txs / proposer {block.proposer}</p>
                  <p>{block.finalized ? 'Finalized' : `${block.remainingToFinality} blocks to finality`}</p>
                </div>
                <span>{block.hash.slice(0, 14)}...</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Transactions</p>
              <h2>Latest AFC activity</h2>
            </div>
          </div>
          <div className="list">
            {transactions.map((transaction) => (
              <article className="list-card" key={transaction.id}>
                <div>
                  <h3>{transaction.type}</h3>
                  <p>{transaction.sender}</p>
                  <p>{transaction.finalized ? 'Finalized' : 'Pending finality'}</p>
                </div>
                <span>
                  {transaction.receipt?.gasUsed ? `${transaction.receipt.gasUsed} gas / ` : ''}
                  fee {formatAfc(transaction.receipt?.minimumFee || transaction.fee)} AFC
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Treasury</p>
              <h2>Core reserves and inclusion pools</h2>
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
            <article className="account-card">
              <h3>Reward liabilities</h3>
              <p>{formatAfc(treasury?.rewardLiabilities)} AFC pending for stakers</p>
              <p>{formatAfc(treasury?.pendingWithdrawalTotal)} AFC in unbonding queue</p>
              <p>{Number(treasury?.treasuryGrantCount || 0).toLocaleString('en-US')} grants approved</p>
              <p>{formatAfc(treasury?.treasuryGrantVolume)} AFC disbursed</p>
              <p>{Number(treasury?.treasuryVestingCount || 0).toLocaleString('en-US')} vesting schedules created</p>
              <p>{formatAfc(treasury?.treasuryVestingEscrowBalance)} AFC reserved in vesting escrow</p>
            </article>
            {(treasury?.pendingTreasuryGrants || []).slice(0, 3).map((grant) => (
              <article className="proposal-card" key={grant.id}>
                <div>
                  <h3>{grant.label || grant.recipient}</h3>
                  <p>{grant.recipient}</p>
                  <p>
                    Starts at block {grant.startHeight} / {grant.vestingBlocks} vesting blocks
                  </p>
                </div>
                <span>{formatAfc(Math.max(0, grant.amount - grant.amountReleased))} AFC pending</span>
              </article>
            ))}
            {(treasury?.recentVestingReleases || []).slice(0, 3).map((release) => (
              <article className="list-card" key={release.id}>
                <div>
                  <h3>{release.label || release.recipient}</h3>
                  <p>{release.type}</p>
                </div>
                <span>{formatAfc(release.amount)} AFC</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Peers & Mempool</p>
              <h2>Operational signals</h2>
            </div>
          </div>
          <div className="list">
            {(network?.peers || []).map((peer) => (
              <article className="list-card" key={peer.url}>
                <div>
                  <h3>{peer.label || peer.url}</h3>
                  <p>{peer.region || 'Unknown region'} / {peer.status}</p>
                </div>
                <span>{peer.lastSeenAt ? 'seen' : 'idle'}</span>
              </article>
            ))}
            <article className="account-card">
              <h3>Sync Summary</h3>
              <p>Tip #{network?.chain?.height ?? '-'}</p>
              <p>Finalized #{network?.chain?.finalizedHeight ?? '-'}</p>
              <p>{network?.chain?.finalityDepth ?? '-'} block finality window</p>
            </article>
            {(mempool?.transactions || []).map((transaction) => (
              <article className="proposal-card" key={transaction.id}>
                <div>
                  <h3>{transaction.type}</h3>
                  <p>{transaction.sender}</p>
                </div>
                <span>pending</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="section-header">
            <div>
              <p className="eyebrow">Validators & Contracts</p>
              <h2>Security and dApp surface</h2>
            </div>
          </div>
          <div className="list">
            {validators.map((validator) => (
              <article className="validator-card" key={validator.address}>
                <div>
                  <h3>{validator.name}</h3>
                  <p>
                    {validator.region} / {formatAfc(validator.totalStake)} AFC
                  </p>
                </div>
                <span>{validator.blocksProduced} blocks</span>
              </article>
            ))}
            {contracts.map((contract) => (
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
              <p className="eyebrow">DAO & Faucet</p>
              <h2>Coordination and bootstrap support</h2>
            </div>
          </div>
          <div className="list">
            {proposals.map((proposal) => (
              <article className="proposal-card" key={proposal.id}>
                <div>
                  <h3>{proposal.title}</h3>
                  <p>{proposal.summary}</p>
                  <p>{proposal.category} / ends at block {proposal.endHeight}</p>
                  {proposal.grantVolume ? <p>Grant volume: {formatAfc(proposal.grantVolume)} AFC</p> : null}
                  {proposal.vestingGrantCount ? <p>{proposal.vestingGrantCount} grants use vesting.</p> : null}
                  {proposal.grantSchedules?.length ? <p>{proposal.grantSchedules.length} vesting schedules approved.</p> : null}
                  {proposal.executionError ? <p>{proposal.executionError}</p> : null}
                </div>
                <span>{proposal.status}</span>
              </article>
            ))}
            {(faucet?.recentDisbursements || []).slice(0, 4).map((entry) => (
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
