# Ethereum Sepolia Deployment

Deploy only after the contract tests pass. The selected chain is Ethereum
Sepolia (`11155111`), and the deployment script also checks its genesis block
hash. It deploys `MockUSDC` first, then `ConvergeGroupWallet` bound to that
token. It verifies both transaction receipts, deployed bytecode, the token's
minter, and the wallet's configured token before recording a public manifest.

## Prepare

1. Install Node.js 24.19.0, pnpm 11.19.0, and Foundry v1.8.3. See
   [MACBOOK_DEMO.md](MACBOOK_DEMO.md) for macOS instructions.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`,
   `pnpm contracts:test`, `pnpm contracts:build`, and `pnpm contracts:abi`.
3. Copy `.env.example` to an ignored `.env` if it does not already exist. Set
   `RPC_URL` to the team's Ethereum Sepolia endpoint and
   `DEPLOYER_PRIVATE_KEY` to the dedicated testnet deployment account. Do not
   put the key in Git, chat, logs, screenshots, or browser code. The key used
   on the Windows development machine is in its local ignored `.env`. The
   presentation MacBook only needs this key if it will mint additional tokens
   or deploy contracts; using the existing deployment does not require it.
4. Fund the public deployer address with Sepolia ETH for two deployments and
   later mock-token mints. This is testnet gas, separate from MockUSDC. The
   script stops before sending if the account has no ETH.

## Deploy and inspect

```sh
pnpm deploy:sepolia
```

The script requires a matching chain ID and Sepolia genesis hash. It saves
transaction hashes immediately to an ignored
`contracts/deployments/11155111.pending.json`, so a restarted run waits for
the already submitted transaction instead of submitting it again. After
verifying both receipts and contracts, it writes the nonsecret
`contracts/deployments/11155111.json` manifest. The manifest records each
address, transaction hash, block number, block hash, deployed code hash,
chain ID, and deployer address. Review these against the explorer and the RPC
before committing the manifest. Once a final manifest exists, the script
refuses another deployment rather than silently replacing it.

Set `MOCK_USDC_ADDRESS` and `GROUP_WALLET_ADDRESS` in the ignored `.env` from
the verified manifest. The exported ABIs in `src/lib/abi` are shared with the
application. Any contract-code change requires rebuilding, re-exporting ABIs,
retesting, and deploying new addresses; never describe an old deployment as
running new code.

## Mint demo balances

The deployer is the sole MockUSDC minter. Six dedicated demo accounts have
been generated for a single-operator rehearsal. Their private keys are in the
ignored local `.env`; their public addresses are recorded in
[`demo-participants.11155111.json`](../contracts/deployments/demo-participants.11155111.json).
Each account received 0.001 Sepolia ETH and 30 MockUSDC. All twelve transaction
receipts succeeded; mint events and account balances were checked. The public
transaction record is
[`demo-funding.11155111.json`](../contracts/deployments/demo-funding.11155111.json).

A public address is part of a wallet, not a separately created credential.
For an independently controlled participant session, each person can select Ethereum Sepolia in their wallet and copy the
account's `0x` address. Six distinct accounts are required. Each participant
keeps control of their wallet and signs their own contributions and refunds;
the deployer does not need their private keys. Confirm that each person can
access and sign with the address before issuing tokens.

The following demo persona labels are not team assignments. Participant names
remain blank until people claim the roles. Balances below reflect the completed
initial allocation; later demo transactions will change them.

| Demo persona | Participant name | Public wallet address | Sepolia gas checked | MockUSDC mint transaction |
| --- | --- | --- | --- | --- |
| Alice | | `0x2163ea96654282508c6A1C2A2946B2521D882f6A` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0x59024f44152fe2c10db849ee7dc00ece40ae9ed7976eb40c9a65bef1f1fefc35) |
| Bob | | `0xfA17Db56195B9F40025aD09F4372EB72a29d1db6` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0x390e42ebdbf86ba47108f01a88d8d0500aa0847d443ccf32c21aec4383c467b9) |
| Charlie | | `0x5989458B5D6e12943E7F7C28019b3C6Eadd3dc72` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0x65a8cb76da3791ce49a7333b85d4ca639a6ee713377994c4f9d9d5b7962a110f) |
| Dana | | `0xB6ba8fAd31615EA6b10b0188C627F6905a862A32` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0x26dabeae809607631247ef34f398cec7231facfbff11212de716745b89bb97e0) |
| Erin | | `0x6D5C0433f16D44fB7552F365bf93ebf2C531d5aA` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0xf7164467a59a3a49110526d57d7b328d526f3d10df8ee7983ec39f9dedebb30d) |
| Farah | | `0x6f677023c08341985a557149a8c79b8D794F7458` | 0.001 ETH | [30 MockUSDC](https://sepolia.etherscan.io/tx/0xe592a109c9cdba68590d0190854d217a2bd8b877cb075da84f5c14748f1594f3) |

Six generated accounts on one machine can simulate the contract workflow,
but do not demonstrate six independently controlled participants. If the team
uses this rehearsal mode, label it explicitly in the evidence and keep
generated test keys outside Git. This is the currently selected demo mode.

`pnpm demo:wallets` generates missing participant keys in the ignored `.env`
and exports only public addresses. Reruns reuse valid existing keys and refuse
to replace a different public manifest. On the demo MacBook, transfer the test
keys privately before running this command so it uses the same accounts.

After recording an address, mint the agreed allocation with:

```sh
pnpm mint:mock 0xRECIPIENT_ADDRESS 30000000
```

The initial six allocations are already complete. Do not run the individual
mint command again unless an additional allocation is intended. The completed
`pnpm demo:fund` workflow records each submitted transaction immediately;
reruns check those receipts without resending recorded allocations. Preserve
its public funding record when moving the project to the MacBook.

`30000000` means 30 MockUSDC, enough for one 10 MockUSDC contribution in each
of three separate full demo runs. The command verifies the minter, waits for a
successful receipt, and checks the mint `Transfer` event. Each participant
also needs Sepolia ETH to approve the ERC-20 allowance, contribute, and claim
refunds. The executor needs Sepolia ETH to pay the approved deposit. Record
actual allocations and transaction hashes as evidence; do not present example
values as completed on-chain actions.

## Status

Use these public settings in the demo machine's ignored `.env` to connect to
the existing deployment:

```dotenv
CHAIN_ID=11155111
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
MOCK_USDC_ADDRESS=0x4707bde238399a27f88855a34bfb31f20b386b17
GROUP_WALLET_ADDRESS=0xd43172d5bd904b68004d69545fd01dbcfdb82a89
```

The endpoint is listed in the [Ethereum chain registry](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-11155111.json)
and was checked for the Sepolia chain ID and genesis hash before deployment.
Check its availability from the demo venue during rehearsal.

The contract suite passed locally on Windows, and both contracts were deployed
and verified on Ethereum Sepolia. The public deployment manifest is
[`contracts/deployments/11155111.json`](../contracts/deployments/11155111.json).
The local Windows `.env` uses the public PublicNode Sepolia RPC and contains
the deployed contract addresses. All six demo participants are funded. No group
decision, payment, or refund has been performed yet; those transactions must be
recorded after the remaining workflow and executor/merchant configuration are ready.
