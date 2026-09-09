// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

/**
 * NextKeyNames — the gate in front of a free name under nextkey.eth.
 *
 * WHY THIS EXISTS
 *
 * Handing out names needs ROLE_REGISTRAR on the UserRegistry. That role is
 * binary: whoever holds it may call register(), as often as they like, until
 * somebody takes the role away. Held by a key published in a web page, the only
 * real limits are the key's balance and how quickly the owner notices.
 *
 * A rule that lives in a key is not a rule. This contract holds the role
 * instead, and the rules live here, where they are enforced by the chain rather
 * than by whoever is holding the key at the time:
 *
 *   · one name per address, ever
 *   · a hard cap on how many names this contract will ever mint
 *   · a deny list the operator can add to
 *   · a pause that stops everything without touching a single existing name
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *
 * It holds no funds and has no payable function. It cannot transfer a name,
 * cannot change a name's records, and cannot take a name back once minted — the
 * registry gives the name to `to`, and nothing here reaches into it afterwards.
 * Turning this contract off, revoking its role, or losing its operator key
 * leaves every name already handed out exactly where it is.
 *
 * WHO MAY CALL claim()
 *
 * Either the future owner themselves — they pay their own gas — or a relayer
 * the operator has named, which is how the page can hand somebody a name
 * without asking them for gas they may not have. Anyone else is refused, so a
 * stranger cannot burn a victim's one allowance on a name they did not want.
 *
 * NOT AUDITED. Written for a testnet prototype during ETHGlobal ETHOnline 2026.
 */

interface IUserRegistry {
    /**
     * The deployed registry takes the label as a *string*, not bytes32.
     *
     * The documentation gives it as bytes32; the deployed contract does not
     * have that function, and calling it reverts with empty data — which reads
     * like "your call failed" rather than "that function does not exist". That
     * trap cost a day once already and is written down in
     * scripts/register-subname.mjs; it is repeated here because an interface
     * that gets this wrong compiles perfectly and fails only on chain.
     */
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external;

    function findOwner(string calldata label) external view returns (address);
}

contract NextKeyNames {
    // ─── What a claimant receives on their own name ────────────────────────
    // The same bitmap a stored secret gets: they may point the name at another
    // registry and at another resolver, and may pass both rights on. No
    // ROLE_REGISTRAR — a name handed out here must not be able to mint children
    // of its own — and nothing that reaches any other name in the registry.
    uint256 private constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 private constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 private constant OWNER_ROLES =
        ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128) |
        ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128);

    IUserRegistry public immutable registry;
    address public immutable resolver;

    address public operator;
    address public relayer;
    uint256 public cap;
    uint256 public minted;
    uint64 public duration;
    bool public paused;

    mapping(address => string) public nameOf;
    mapping(address => bool) public denied;

    event Claimed(address indexed owner, string label, address indexed by);
    event OperatorChanged(address indexed from, address indexed to);
    event RelayerChanged(address indexed relayer);
    event CapChanged(uint256 cap);
    event DurationChanged(uint64 duration);
    event PausedChanged(bool paused);
    event DeniedChanged(address indexed account, bool denied);

    error NotOperator();
    error NotYoursToClaim();
    error AlreadyClaimed(string label);
    error CapReached(uint256 cap);
    error Denied();
    error Paused();
    error EmptyLabel();
    error LabelTaken();
    error ZeroAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address registry_,
        address resolver_,
        uint256 cap_,
        uint64 duration_
    ) {
        if (registry_ == address(0) || resolver_ == address(0)) revert ZeroAddress();
        registry = IUserRegistry(registry_);
        resolver = resolver_;
        operator = msg.sender;
        cap = cap_;
        duration = duration_;
        emit OperatorChanged(address(0), msg.sender);
        emit CapChanged(cap_);
        emit DurationChanged(duration_);
    }

    /**
     * Hand out one name.
     *
     * Every rule is checked before the registry is touched, and the record of
     * the claim is written before the external call — so a registry that
     * re-entered would find this address already spent rather than a second
     * allowance.
     */
    function claim(string calldata label, address to) external {
        if (paused) revert Paused();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != to && msg.sender != relayer) revert NotYoursToClaim();
        if (denied[to]) revert Denied();
        if (bytes(label).length == 0) revert EmptyLabel();

        string memory had = nameOf[to];
        if (bytes(had).length != 0) revert AlreadyClaimed(had);
        if (minted >= cap) revert CapReached(cap);

        // Asked rather than assumed. The registry would revert on a taken name
        // anyway, but a named error is worth more to a page that has to explain
        // itself to somebody typing a label.
        if (registry.findOwner(label) != address(0)) revert LabelTaken();

        nameOf[to] = label;
        unchecked { minted += 1; }

        registry.register(
            label,
            to,
            address(0),
            resolver,
            OWNER_ROLES,
            uint64(block.timestamp) + duration
        );

        emit Claimed(to, label, msg.sender);
    }

    /** Has this address already been given a name here? */
    function claimed(address who) external view returns (bool) {
        return bytes(nameOf[who]).length != 0;
    }

    /** How many more this contract will hand out before it stops. */
    function remaining() external view returns (uint256) {
        return minted >= cap ? 0 : cap - minted;
    }

    // ─── Operator ──────────────────────────────────────────────────────────
    // Nothing here can reach a name that was already handed out. The strongest
    // thing the operator can do is stop the contract handing out more.

    function setRelayer(address relayer_) external onlyOperator {
        relayer = relayer_;
        emit RelayerChanged(relayer_);
    }

    function setCap(uint256 cap_) external onlyOperator {
        cap = cap_;
        emit CapChanged(cap_);
    }

    function setDuration(uint64 duration_) external onlyOperator {
        duration = duration_;
        emit DurationChanged(duration_);
    }

    function setPaused(bool paused_) external onlyOperator {
        paused = paused_;
        emit PausedChanged(paused_);
    }

    function setDenied(address account, bool denied_) external onlyOperator {
        denied[account] = denied_;
        emit DeniedChanged(account, denied_);
    }

    function transferOperator(address to) external onlyOperator {
        if (to == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, to);
        operator = to;
    }

    /**
     * Give up control for good.
     *
     * After this the cap, the deny list and the relayer are frozen at whatever
     * they are, and nobody can change them again — including us. It is here
     * because a contract that hands out names on a public registry should be
     * able to prove it has stopped being ours to steer.
     */
    function renounceOperator() external onlyOperator {
        emit OperatorChanged(operator, address(0));
        operator = address(0);
    }
}
