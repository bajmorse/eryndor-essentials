/**
 * Whether *this* client is the one that should perform a gated write.
 *
 * Document hooks fire identically on every connected client, but a world-scoped
 * write should happen exactly once. `game.users.activeGM` is Foundry's
 * designated single GM — the same user object on every client — so comparing
 * `isSelf` picks exactly one writer with no socket coordination needed.
 */
export function isWriter(): boolean {
  return game.users?.activeGM?.isSelf === true;
}
