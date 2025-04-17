
/**
 * This script creates, queues, and applies gamefile states
 * to the gamefile when a Move is created, and executed.
 */


// @ts-ignore
import type { Move, NullMove, path } from "./movepiece.js";
// @ts-ignore
import type { gamefile } from "./gamefile.js";
import { Coords } from "./movesets.js";
import { CoordsKey } from "../util/coordutil.js";


// Type Definitions ------------------------------------------------------------------------------------


// TODO: Move to gamefile type definition (right now it's not in typescript)
type inCheck = false | Coords[];
// TODO: Move to gamefile type definition (right now it's not in typescript)
type attacker = { coords: Coords } & ({ slidingCheck: true } | { slidingCheck: false, path?: path });
// TODO: Move to gamefile type definition (right now it's not in typescript)
type attackers = attacker[];

/**
 * 
 * Local statechanges are unique to the move you're viewing, and are always applied. Those include:
 * 
 * check, attackers
 * 
 * Global statechanges are a property of the game as a whole, not unique to the move,
 * and are not applied when VIEWING a move.
 * However, they are applied only when we make a new move, or rewind a simulated one. Those include:
 * 
 * enpassant, specialrights, moverulestate
 */

/**
 * Contains the statechanges for the turn before and after a move is made
 * 
 * Local state change examples: (check, attackers)
 * Global state change examples: (enpassant, specialrights, moverule state, running check counter)
 */
interface MoveState {
	local: Array<StateChange>,
	global: Array<StateChange>,
}

/**
 * A state change, local or global, that contains enough information to set the gamefile's
 * property whether the move is being rewound or replayed.
 */
type StateChange = {
	/** The type of state this {@link StateChange} is */
	type: 'check',
	/* The gamefile's property of this type BEFORE this move was made, used to restore them when the move is rewinded. */
	current: inCheck,
	/* The gamefile's property of this type AFTER this move was made, used to restore them when the move is replayed. */
	future: inCheck
} | {
	type: 'attackers',
	current: attackers,
	future: attackers
} | {
	type: 'enpassant',
	current?: EnPassant,
	future?: EnPassant
} | {
	type: 'specialrights'
	current: boolean,
	future: boolean
	/** The coordsKey of what square was affected by this specialrights state change. */
	coordsKey: CoordsKey
} | {
	type: 'moverulestate'
	current: number,
	future: number
}

// TODO: Move to gamefile type definition (right now it's not in typescript)
interface EnPassant {
	/** The enpassant square. */
	square: Coords,
	/**
	 * The square the pawn that doubled pushed is on. 
	 * 
	 * We need this info, because otherwise in the 5D variant, 
	 * you can't tell where the pawn is that double pushed.
	 * It could be 1 square away, or 10.
	 */
	pawn: Coords
}


// Creating Local State Changes --------------------------------------------------------------------



/** Creates a check local StateChange, adding it to the Move and immediately applying it to the gamefile. */
function createCheckState(move: Move | NullMove, current: inCheck, future: inCheck, gamefile: gamefile) {
	const newStateChange: StateChange = { type: 'check', current, future };
	move.state.local.push(newStateChange); // Check is a local state
	// Check states are immediately applied to the gamefile
	applyState(gamefile, newStateChange, true);
}

/** Creates an attackers local StateChange, adding it to the Move and immediately applying it to the gamefile. */
function createAttackersState(move: Move | NullMove, current: attackers, future: attackers, gamefile: gamefile) {
	const newStateChange: StateChange = { type: 'attackers', current, future };
	move.state.local.push(newStateChange); // Attackers is a local state
	// Attackers states are immediately applied to the gamefile
	applyState(gamefile, newStateChange, true);
}


// Creating Global State Changes --------------------------------------------------------------------


/** Creates an enpassant global StateChange, queueing it by adding it to the Move. */
function createEnPassantState(move: Move | NullMove, current?: EnPassant, future?: EnPassant) {
	if (current === future) return; // If the current and future values are identical, we can skip queueing this state.
	const newStateChange: StateChange = { type: 'enpassant', current, future };
	// Check to make sure there isn't already an enpassant state change,
	// If so, we need to overwrite that one's future value, instead of queueing a new one.
	const preExistingEnPassantState = move.state.global.find(state => state.type === 'enpassant');
	if (preExistingEnPassantState !== undefined) preExistingEnPassantState.future = future;
	else move.state.global.push(newStateChange); // EnPassant is a global state
}

/** Creates a specialrights global StateChange, queueing it by adding it to the Move. */
function createSpecialRightsState(move: Move, coordsKey: CoordsKey, current: boolean, future: boolean) {
	if (current === future) return; // If the current and future values are identical, we can skip queueing this state.
	const newStateChange: StateChange = { type: 'specialrights', current, future, coordsKey };
	move.state.global.push(newStateChange); // Special Rights is a global state
}

/** Creates a moverule global StateChange, queueing it by adding it to the Move. */
function createMoveRuleState(move: Move | NullMove, current: number, future: number) {
	if (current === future) return; // If the current and future values are identical, we can skip queueing this state.
	const newStateChange: StateChange = { type: 'moverulestate', current, future };
	move.state.global.push(newStateChange); // Special Rights is a global state
}


// Applying State Changes ----------------------------------------------------------------------------


/**
 * Applies all the StateChanges of a Move, in order, to the gamefile,
 * whether forward or backward, local or global.
 */
function applyMove(
	gamefile: gamefile,
	move: Move | NullMove,
	/** Whether we're playing this move forward or backward. */
	forward: boolean,
	/**
	 * Specify `globalChange` as true if you are making a physical move in the game,
	 * or rewinding a simulated move.
	 * All other situations, such as rewinding and forwarding the game, should only
	 * be local, so `globalChange` should be false.
	 */
	{ globalChange = false } = {}
) {
	for (const change of move.state.local) {
		applyState(gamefile, change, forward);
	}
	if (!globalChange) return;
	for (const change of move.state.global) {
		applyState(gamefile, change, forward);
	}
}

/**
 * Applies the state of a move to the gamefile, whether forward or backward.
 */
function applyState(gamefile: gamefile, state: StateChange, forward: boolean) {
	const noNewValue = (forward ? state.future : state.current) === undefined;
	switch (state.type) {
		case 'specialrights':
			if (!(forward ? state.future : state.current)) gamefile.specialRights.delete(state.coordsKey);
			else gamefile.specialRights.add(state.coordsKey);	
			break;
		case 'check':
			gamefile.inCheck = forward ? state.future : state.current;
			break;
		case 'attackers':
			if (noNewValue) gamefile.attackers = [];
			else gamefile.attackers = forward ? state.future : state.current;
			break;
		case 'enpassant': 
			if (noNewValue) delete gamefile.enpassant;
			else gamefile.enpassant = forward ? state.future : state.current;
			break;
		case 'moverulestate':
			gamefile.moveRuleState = forward ? state.future : state.current;
			break;
	}
}


// Exports --------------------------------------------------------------------------


export default {
	applyState,
	applyMove,
	createCheckState,
	createAttackersState,
	createEnPassantState,
	createSpecialRightsState,
	createMoveRuleState,
};

export type {
	MoveState,
	StateChange,
	attackers,
	EnPassant,
};