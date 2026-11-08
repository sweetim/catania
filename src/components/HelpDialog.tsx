import { COSTS, victoryTarget } from "../game/engine";
import { isSeafarers, type GameVariant } from "../game/types";
import { useLanguage, useTranslation } from "../localization";
import { helpTranslations } from "../translations/help";
import { getDevelopmentNames, getDevelopmentDescriptions } from "./GameplayDialogs";
import { CardTypeIcon, Cost, DevelopmentCardIcon, Dialog, PieceIcon } from "./GameUi";

export function HelpDialog({ onClose, multiplayer = false, variant = "original" }: { onClose: () => void; multiplayer?: boolean; variant?: GameVariant }) {
  const { language } = useLanguage();
  const translateText = useTranslation(helpTranslations);
  const developmentNames = getDevelopmentNames(language);
  const developmentDescriptions = getDevelopmentDescriptions(language, variant);
  const scenarioRules = variant === "four-islands"
    ? "Start on any of the four islands. Your first settlement on each island not occupied by either of your two starting settlements earns 2 extra points, even if another player settled there first. Reach 12 points on your own turn to win."
    : variant === "fog-islands"
      ? "Place starting settlements on any revealed starting island. When an endpoint of a newly placed road or ship, or a moved ship, touches fog, reveal that hex. Resource land immediately grants one matching resource from the bank; gold grants one resource choice; sea grants nothing. There are no island bonuses. Reach 12 points on your own turn to win."
      : variant === "foggy-world"
        ? "Before each starting settlement, reveal fog hexes of your choice. Sea grants nothing and lets you select again; resource land grants one matching bank card, gold grants one resource choice, and desert ends the reveal. Place the settlement on any revealed land. Each harbor appears only when the hex carrying it is revealed, and grants its trade ratio from then on. After setup, endpoints of newly placed roads or ships, and moved ships, reveal adjacent fog with the same rewards. Neither robber nor pirate may enter fog. There are no island bonuses. Reach 12 points on your own turn to win."
        : "Start on the main island. Your first settlement on each small island earns 2 extra points, even if another player settled there first. Reach 13 points on your own turn to win.";
  return (
    <Dialog title={translateText("Help")} onClose={onClose} wide>
      <div className="space-y-8 text-sm leading-7 text-muted">
        <p className="font-serif text-xl text-ink">
          {translateText("Good neighbors. Clever trades. {points} victory points.", { points: victoryTarget(variant) })}
        </p>
        {isSeafarers(variant) && <section aria-labelledby="help-seafarers" className="space-y-3">
          <h3 id="help-seafarers" className="font-serif text-2xl text-ink">{translateText("Seafarers rules")}</h3>
          <p>{translateText(scenarioRules)}</p>
          <p>{translateText("A ship costs 1 wood and 1 wool; you have 15 ships in addition to 15 roads. Ships use sea or coastal edges and connect to your ships or buildings. Roads and ships join only at your settlement or city. Both count toward Longest Route. Road Building may place either piece.")}</p>
          <p>{translateText("After rolling, move at most one open-ended ship per turn, never one built this turn. Ships between your buildings cannot move. The pirate blocks building and moving ships on its hex, but does not break existing routes or block harbors.")}</p>
          <p>{translateText("On a seven or Knight, move the robber to another revealed land hex or the pirate to another revealed sea hex or off the board. Neither may enter fog. The pirate steals from a player with an adjacent ship. Gold fields produce one resource choice per settlement or two per city, chosen from the bank in turn order starting with the active player.")}</p>
        </section>}
        <section aria-labelledby="help-how-to-play">
          <h3 id="help-how-to-play" className="mb-4 font-serif text-2xl text-ink">{translateText("How to play")}</h3>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong className="text-ink">{translateText("Settle the island.")}</strong>{" "}
              {translateText(isSeafarers(variant)
                ? "Place two starting settlements and an adjoining road or ship in snake order. Your second settlement grants resources from adjacent revealed resource land. Follow the scenario's starting-island restrictions."
                : "Choose three or four players, with computers filling any non-human seats. Turn order is randomized. Each player places a free settlement and adjoining road in order, then again in reverse. Your second settlement grants one resource from each neighboring non-desert hex.")}
            </li>
            <li>
              <strong className="text-ink">{translateText("Roll and gather.")}</strong>{" "}
              {translateText("Roll two dice once on your turn. All players collect from matching hexes. Resolve any discards, robber moves, and theft before continuing. An eligible development card can be played before or after rolling.")}
            </li>
            <li>
              <strong className="text-ink">{translateText("Trade, build, and pass.")}</strong>{" "}
              {isSeafarers(variant) ? translateText("Trade, build, and buy cards after rolling. Confirm placements on the board. Finish all required choices before ending your turn. Reach {points} points on your own turn to win.", { points: victoryTarget(variant) })
                : translateText("After rolling, trade, build, and buy cards in any order while you have the resources. Select a highlighted location on the {board}, then confirm the placement; Cancel or Escape clears the preview. Finish required choices before ending your turn. Reach 10 points on your own turn to win.", { board: translateText(multiplayer ? "shared board" : "board") })}
            </li>
          </ol>
        </section>

        <section aria-labelledby="help-builds">
          <h3 id="help-builds" className="mb-4 font-serif text-2xl text-ink">{translateText("Builds and costs")}</h3>
          <p className="mb-4">{translateText("Pay these resources to the bank after rolling. You need a legal location and an available piece to build.")}</p>
          <ul aria-label={translateText("Available builds and purchases")} className="grid gap-3 sm:grid-cols-2">
            {isSeafarers(variant) && <li className="rounded-xl border border-line bg-white/30 p-4">
              <div className="mb-3 flex items-center gap-3 text-forest"><PieceIcon piece="ship" /><h4 className="font-semibold text-ink">{translateText("Ship")}</h4></div>
              <Cost resources={COSTS.ship} />
              <p className="mt-3 text-xs leading-6">{translateText("A ship costs 1 wood and 1 wool; you have 15 ships in addition to 15 roads. Ships use sea or coastal edges and connect to your ships or buildings. Roads and ships join only at your settlement or city. Both count toward Longest Route. Road Building may place either piece.")}</p>
            </li>}
            {([
              { piece: "road", name: "Road", description: "Connect an empty edge to your own road, settlement, or city. You cannot extend through an opponent's building. Roads earn no points by themselves. Limit: 15 roads." },
              { piece: "settlement", name: "Settlement", description: "Build on an empty intersection beside your road, at least two edges from every settlement or city. Worth 1 point; produces 1 resource per matching neighboring hex. Limit: 5 settlements." },
              { piece: "city", name: "City", description: "Upgrade one of your settlements, returning its piece to your supply. Worth 2 points total; produces 2 resources per matching neighboring hex. Limit: 4 cities." },
              { piece: "development", name: "Development card", description: "Draw a hidden card from the shuffled deck. There are 25 cards; purchases stop when the deck is empty. Cards cannot be traded." },
            ] as const).map(({ piece, name, description }) => (
              <li key={piece} className="min-w-0 rounded-xl border border-line bg-white/30 p-4">
                <div className="mb-3 flex items-center gap-3 text-forest">
                  {piece === "development" ? <CardTypeIcon kind="development" /> : <PieceIcon piece={piece} />}
                  <h4 className="font-semibold text-ink">{translateText(name)}</h4>
                </div>
                <Cost resources={COSTS[piece]} />
                <p className="mt-3 text-xs leading-6">{translateText(isSeafarers(variant) && piece === "settlement"
                  ? "Build on an empty land intersection beside your roads or ships, at least two edges from every building. Worth 1 point; produces 1 resource per matching land hex. Limit: 5 settlements."
                  : description)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="help-development-cards">
          <h3 id="help-development-cards" className="mb-4 font-serif text-2xl text-ink">{translateText("Development cards")}</h3>
          <p className="mb-4">
            {translateText("All five card types are shown here, whether or not you own them. Counts show the starting deck, not the cards remaining. Play at most one action development card per turn, never on the turn you bought it. Finish mandatory choices before playing a card. Victory-point cards count automatically and do not use this allowance.")}
          </p>
          <ul aria-label={translateText("All development cards")} className="space-y-3">
            {([
              ["knight", 14], ["victory-point", 5], ["road-building", 2],
              ["year-of-plenty", 2], ["monopoly", 2],
            ] as const).map(([kind, count]) => (
              <li key={kind} className="flex gap-3 rounded-xl border border-line bg-white/30 p-4">
                <span className="text-forest"><DevelopmentCardIcon kind={kind} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 className="font-semibold text-ink">{developmentNames[kind]}</h4>
                    <span className="rounded-md bg-moss px-2 py-0.5 text-xs font-semibold text-ink">{translateText("{count} in starting deck", { count })}</span>
                  </div>
                  <p className="mt-1 text-xs leading-6">{developmentDescriptions[kind]}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-6">
            {translateText("Knight does not trigger discards. You may cancel it before confirming the robber move, unless it has already won the game. Road building needs a remaining road piece and stops early if no legal placements remain. Year of plenty can take two of the same resource, but cannot be played with an empty bank. Played action cards leave your hand.")}
          </p>
        </section>

        <section aria-labelledby="help-rules" className="space-y-4">
          <h3 id="help-rules" className="font-serif text-2xl text-ink">{translateText("Game rules")}</h3>
          <p>
            <strong className="text-ink">{translateText("Resources and production.")}</strong>{" "}
            {translateText("Forests produce wood, hills brick, pastures wool, fields grain, and mountains ore. The desert produces nothing. On a matching dice total, each adjacent settlement receives one resource and each city two, unless the robber blocks that hex. The bank starts with 19 of each resource. If it cannot satisfy all claims for a resource and multiple players need it, nobody receives that resource this roll. If only one player needs it, they take what remains. Other resources still produce normally.")}
          </p>
          <p>
            <strong className="text-ink">{translateText("Seven and the robber.")}</strong>{" "}
            {translateText("A seven produces no resources. Every player with more than seven resource cards chooses half, rounded down, to return to the bank; development cards do not count. After all discards, the active player moves the robber to a different hex, including the desert, and chooses one opponent with an adjacent settlement or city to steal one random resource from. An empty hand gives nothing; if no opponent is adjacent, skip theft. The robber stays and blocks production until moved again.")}
          </p>
          <p>
            <strong className="text-ink">{translateText("Trading and ports.")}</strong>{" "}
            {translateText("After rolling, the active player can exchange four of one resource for one different resource available in the bank (4:1). Their settlement or city on a generic port improves this to 3:1; a matching resource port allows 2:1 for that resource. Player trades must involve the active player. Request cards and compare prices, or make an exact offer. Both sides must give resources, with no resource appearing on both sides. No gifts or development-card trades. Nothing moves until the active player confirms one exchange and both players still have the cards.")}
          </p>
          <p>
            <strong className="text-ink">{translateText("Points and victory.")}</strong>{" "}
            {translateText(isSeafarers(variant) ? scenarioRules : "Each settlement is 1 point, each city 2, and each hidden victory-point card 1. Longest Road and Largest Army are worth 2 points each. Reach at least 10 on your own turn to win, including cards bought that turn. Opponents see only your public score until the game ends.")}
          </p>
          <p>
            <strong className="text-ink">{translateText("Longest Road and Largest Army.")}</strong>{" "}
            {translateText(isSeafarers(variant) ? "Longest Route counts roads and ships, joined only at your buildings. Largest Army still needs at least three played Knights. Awards are worth 2 points each; ties stay with the qualifying holder." : "Longest Road needs at least five roads in one continuous trail, not your total network. Count each road once; loops can count, branches do not all add together, and an opponent's building interrupts the trail. Largest Army needs at least three played Knights. For either award, the highest qualifying player holds it. A tie stays with the current holder if they are among the leaders; otherwise a tie leaves it unclaimed. Surpassing the holder transfers the award and its points.")}
          </p>
          <div className="rounded-xl bg-moss p-4">
            {multiplayer ? (
              <>
                <strong className="text-ink">{translateText("One shared board, private phones.")}</strong>{" "}
                {translateText("Use the shared board for placements and each player's phone for their private hand and choices. The host keeps the game in memory: refreshing or closing the host tab ends the game for everyone, with no host transfer or saved game. If a player leaves, their seat stays reserved while the host remains open. Open the invitation in the same tab to reconnect when browser session storage is available.")}
              </>
            ) : (
              <>
                <strong className="text-ink">{translateText("One device, a whole table.")}</strong>{" "}
                {translateText("Play solo against local AI with your hand always visible, or pass the device before revealing each human's hand. Computer hands cannot be opened. AI handles its own turns and trade responses, including prices for requests. It can request build resources once per turn, wait up to 15 seconds for prices, and complete useful trades with humans or computers, alongside bank and port trades. This is a friendly local game, not a secure multiplayer room. Games live only in this tab: refreshing or closing it ends the game.")}
              </>
            )}
          </div>
        </section>

      </div>
    </Dialog>
  );
}
