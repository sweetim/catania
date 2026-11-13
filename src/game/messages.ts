import { resourceName, translate } from "../i18n";
import type { Language, TranslationParameters } from "../i18n";
import type { DevelopmentKind, Resource } from "./types";

export const gameMessages = {
  "Your game history could not be saved on this device.": "この端末にゲーム履歴を保存できませんでした。",
  "The host did not provide a map code for this game.": "ホストからこのゲームのマップコードを受信できませんでした。",
  "Choose Original or Seafarers.": "オリジナルまたは航海者を選択してください。",
  "Choose a supported game version.": "対応しているゲームの種類を選択してください。",
  "The fog discovery deck is empty.": "霧タイルの山札がありません。",
  "The fog cell has no hidden terrain.": "霧のタイルの地形データがありません。",
  "Finish exploration before continuing.": "探索を完了してから続行してください。",
  "{player} explores a fog hex.": "{player}が霧のタイルを探索しました。",
  "Choose an available starting cell.": "選択可能な初期配置のタイルを選んでください。",
  "{player} finds sea. Choose another starting cell.": "{player}が海を発見しました。別の初期配置のタイルを選んでください。",
  "The board must match the selected game version.": "選択したゲームの種類に合う盤面を使用してください。",
  "The game version can only be changed in the lobby.": "ゲームの種類はロビーでのみ変更できます。",
  "{player} builds a ship.": "{player}が船を建造しました。",
  "{player} moves a ship.": "{player}が船を移動しました。",
  "{player} moves the pirate.": "{player}が海賊を移動しました。",
  "{player} collects gold production.": "{player}が金鉱の資源を受け取りました。",
  "Choose an empty sea or coastal edge connected to your ships or buildings, away from the pirate; you have at most fifteen ships.": "自分の船や建物につながり、海賊に接しない空いている海または沿岸の辺を選択してください。船は最大15隻です。",
  "Move one open-ended ship per turn, not built this turn, to a connected sea edge away from the pirate.": "その手番に建造していない航路の端の船を1隻まで、海賊に接しない接続可能な海の辺に移動してください。",
  "Wait for your gold production choice.": "金鉱の資源を選択する順番をお待ちください。",
  "Choose exactly {count} available resources for gold production.": "金鉱の産出としてバンクにある資源をちょうど{count}枚選択してください。",
  "Move the pirate to a different sea hex.": "海賊を別の海タイルに移動してください。",
  "Choose an eligible opponent beside the robber or pirate.": "盗賊または海賊に接する対象の相手を選択してください。",
  "Place pieces and move the robber or pirate on the shared board, not a phone.": "コマの配置と盗賊・海賊の移動は、スマートフォンではなく共有盤面で行ってください。",
  "{player} begins the first settlement placement.": "{player}が最初の開拓地を配置します。",
  "{player} takes {award}.": "{player}が{award}を獲得しました。",
  "{award} is unclaimed.": "{award}の保有者はいません。",
  "{player} wins with {points} points.": "{player}が{points}点で勝利しました。",
  "The bank cannot supply {resource}; nobody receives that resource this roll.": "銀行の{resource}が不足しているため、今回の出目では誰もその資源を受け取れません。",
  "The bank has only {count} {resource} left; {player} receives less than earned this roll.": "銀行の{resource}が{count}枚しかないため、{player}は産出分すべてを受け取れません。",
  "{player} builds a settlement.": "{player}が開拓地を建設しました。",
  "{player} upgrades a settlement to a city.": "{player}が開拓地を都市に拡張しました。",
  "{player} builds a road.": "{player}が街道を建設しました。",
  "{player} rolls {first} + {second} = {total}.": "{player}の出目は{first} + {second} = {total}です。",
  "{player} discards {count} resource cards.": "{player}が資源カードを{count}枚捨てました。",
  "{player} cancels Knight.": "{player}が騎士の使用を取り消しました。",
  "{player} moves the robber.": "{player}が盗賊を移動しました。",
  "{player} steals one resource card from {victim}.": "{player}が{victim}から資源カードを1枚奪いました。",
  "{player} cannot steal a resource from {victim}'s empty hand.": "{victim}の手札が空のため、{player}は資源を奪えませんでした。",
  "{player} trades {ratio} {give} for one {receive} with the bank.": "{player}が銀行で{give}{ratio}枚を{receive}1枚と交換しました。",
  "{player} offers a trade.": "{player}が交易を提案しました。",
  "{player} withdraws the trade offer.": "{player}が交易提案を取り下げました。",
  "{player} requests resources and invites prices.": "{player}が資源を希望し、交換条件を募集しました。",
  "{player} trades with {other}.": "{player}が{other}と交易しました。",
  "{player} buys a development card.": "{player}が発展カードを購入しました。",
  "{player} plays {kind}.": "{player}が{kind}を使用しました。",
  "{player} finishes Road Building.": "{player}が街道建設を完了しました。",
  "{player} begins a turn.": "{player}のターンが始まります。",
  "Specify a nonnegative whole number for each of the five resources.": "5種類の資源それぞれに0以上の整数を指定してください。",
  "This player is not seated in the game.": "このプレイヤーはゲームに参加していません。",
  "You do not have the resources required for this purchase.": "購入に必要な資源が足りません。",
  "A standard game needs three or four players.": "通常のゲームには3人または4人のプレイヤーが必要です。",
  "Each player needs a name and color.": "各プレイヤーに名前と色を設定してください。",
  "Each player needs human or computer control.": "各プレイヤーの操作を人間またはコンピューターに設定してください。",
  "Choose a different color for each player.": "プレイヤーごとに異なる色を選んでください。",
  "Choose a valid resource to trade.": "交易する資源を正しく選んでください。",
  "The game is finished. Start a new game to play again.": "ゲームは終了しました。もう一度遊ぶには新しいゲームを開始してください。",
  "Choose a valid game action.": "有効なゲーム操作を選んでください。",
  "Wait for your turn to perform this action.": "この操作は自分のターンまでお待ちください。",
  "Roll the dice and finish mandatory choices before this action.": "この操作の前にサイコロを振り、必須の選択を完了してください。",
  "Choose an empty legal intersection, at least two edges from other buildings, connected to your road after setup; you have at most five settlements.": "他の建物から2辺以上離れた空いている交差点を選んでください。初期配置後は自分の街道につながっている必要があります。開拓地は最大5つです。",
  "Upgrade one of your settlements after rolling; you have at most four cities.": "サイコロを振った後、自分の開拓地を拡張してください。都市は最大4つです。",
  "Choose an empty edge connected to your own network without passing an opponent's building; setup roads must touch the new settlement, and you have at most fifteen roads.": "相手の建物を通らず、自分の道路網につながる空いている辺を選んでください。初期配置の街道は新しい開拓地に接している必要があります。街道は最大15本です。",
  "You may roll once per turn, after completing any pre-roll card effect.": "サイコロはターンごとに1回振れます。先に使用したカードの効果を完了してください。",
  "There is no discard to resolve.": "捨てる必要のあるカードはありません。",
  "You have no remaining discard obligation.": "あなたがこれ以上カードを捨てる必要はありません。",
  "Select exactly {count} resource cards to discard.": "捨てる資源カードをちょうど{count}枚選んでください。",
  "You cannot discard resources you do not own.": "持っていない資源は捨てられません。",
  "There is no Knight to cancel before moving the robber.": "盗賊の移動前に取り消せる騎士はありません。",
  "Move the robber only after a seven or a Knight card.": "盗賊を移動できるのは7が出たときか、騎士カードを使ったときだけです。",
  "Move the robber to a different land hex, including the desert.": "盗賊を現在とは別の陸地タイルに移動してください。砂漠にも移動できます。",
  "Move the robber before choosing a victim.": "相手を選ぶ前に盗賊を移動してください。",
  "Choose an opponent with a building adjacent to the robber.": "盗賊に隣接する建物を持つ相手を選んでください。",
  "Choose two different resource types for a maritime trade.": "海上交易では異なる2種類の資源を選んでください。",
  "You need {ratio} {resource} for this trade.": "この交易には{resource}が{ratio}枚必要です。",
  "The bank has no {resource} available.": "銀行に{resource}がありません。",
  "A trade must give and receive resources; gifts are not allowed.": "交易では双方が資源を渡す必要があります。贈与はできません。",
  "Do not offer and request the same resource in a trade.": "同じ資源を渡す側と受け取る側の両方に指定しないでください。",
  "You cannot offer resources you do not own.": "持っていない資源は交易に出せません。",
  "Request at least one resource.": "少なくとも1枚の資源を希望してください。",
  "Only other players may propose a price for an open resource request.": "資源の希望に交換条件を提示できるのは他のプレイヤーだけです。",
  "You do not have the resources requested in this trade.": "この交易で求められている資源を持っていません。",
  "Only other players may respond to the active player's trade offer.": "手番プレイヤーの交易提案に返答できるのは他のプレイヤーだけです。",
  "Choose accept or decline for this trade.": "この交易を承諾するか断るか選んでください。",
  "Propose a price before confirming this request.": "この希望を承諾する前に交換条件を提示してください。",
  "You have no open trade offer to complete.": "成立させられる交易提案はありません。",
  "Choose an opponent who accepted this offer or proposed a price.": "提案を承諾した相手か交換条件を提示した相手を選んでください。",
  "Both players must still hold the offered resources. Make a new offer.": "双方が提案した資源を持っている必要があります。新しい提案をしてください。",
  "You have no open trade offer to cancel.": "取り消せる交易提案はありません。",
  "The development-card deck is empty.": "発展カードの山札がありません。",
  "Finish mandatory choices before playing a development card.": "発展カードを使う前に必須の選択を完了してください。",
  "Choose a development card from your own hand.": "自分の手札から発展カードを選んでください。",
  "Victory-point cards count automatically and are revealed only when you win.": "勝利点カードは自動的に加算され、勝利時にだけ公開されます。",
  "You cannot play a development card bought this turn.": "このターンに購入した発展カードは使えません。",
  "You may play only one development card per turn.": "発展カードは1ターンに1枚だけ使えます。",
  "You need at least one road piece remaining to play Road Building.": "街道建設を使うには街道のコマが少なくとも1本残っている必要があります。",
  "The bank has no resources available for Year of Plenty.": "銀行に収穫で受け取れる資源がありません。",
  "Choose exactly {count} available resource cards for Year of Plenty.": "収穫で受け取る資源を銀行からちょうど{count}枚選んでください。",
  "Choose resources that are available in the bank.": "銀行にある資源を選んでください。",
  "Choose the resource to collect with Monopoly.": "独占で集める資源を選んでください。",
  "There are no free roads to finish placing.": "配置する無料の街道はありません。",
  "Place the remaining free roads while legal locations and road pieces are available.": "配置できる場所と街道のコマがある間は、残りの無料の街道を配置してください。",
  "Random source must return a number from 0 (inclusive) to 1 (exclusive).": "乱数生成元は0以上1未満の数値を返す必要があります。",
  "Unable to arrange nonadjacent red number tokens.": "赤い数字トークンを隣接しないように配置できませんでした。",
  "The board can only be shuffled in the lobby.": "盤面をシャッフルできるのはロビー内だけです。",
  "The victory target can only be changed in the lobby.": "勝利に必要な点数はロビーでのみ変更できます。",
  "Choose a whole number from 3 to 13 victory points.": "勝利に必要な点数を3〜13の整数で選んでください。",
  "Enter a valid 8-character map code.": "8文字の有効なマップコードを入力してください。",
  "Profile stats are shared only after the game finishes.": "プロフィールの成績はゲーム終了後にだけ共有されます。",
  "Computers can only be added in the lobby.": "コンピューターを追加できるのはロビー内だけです。",
  "The room already has four players.": "ルームにはすでに4人のプレイヤーがいます。",
  "Players can only be removed in the lobby.": "プレイヤーを削除できるのはロビー内だけです。",
  "Choose a player in this lobby to remove.": "このロビーから削除するプレイヤーを選んでください。",
  "Computers can only be renamed in the lobby.": "コンピューターの名前を変更できるのはロビー内だけです。",
  "Choose a computer in this lobby to rename.": "このロビーで名前を変更するコンピューターを選んでください。",
  "Choose a name with 1 to 20 characters and no control characters.": "制御文字を含まない1〜20文字の名前を入力してください。",
  "Choose a different name; that name is already in the room.": "その名前はルーム内で使われています。別の名前を選んでください。",
  "This invitation is not valid for this host.": "この招待はこのホストでは使用できません。",
  "This connection has already joined.": "この接続はすでに参加しています。",
  "This reconnect credential is not valid for this room.": "この再接続用の認証情報はこのルームでは使用できません。",
  "This game has started. Only a disconnected player's device can rejoin their seat.": "ゲームは開始済みです。切断されたプレイヤーの端末だけが自分の席に戻れます。",
  "The host has too many pending requests. Try again later.": "ホストへの参加申請が多すぎます。しばらくしてから再試行してください。",
  "Players cannot be admitted after the game starts.": "ゲーム開始後はプレイヤーを承認できません。",
  "That exact join request is no longer connected.": "その参加申請の接続はすでに切れています。",
  "That exact join request is no longer pending.": "その参加申請はすでに保留中ではありません。",
  "The game has already started.": "ゲームはすでに開始しています。",
  "Add three or four players before starting.": "開始する前に3人または4人のプレイヤーを追加してください。",
  "All admitted human players must be connected before starting.": "開始するには承認済みの人間プレイヤー全員が接続している必要があります。",
  "The game changed. Review the latest state and try again.": "ゲームの状態が変わりました。最新の状態を確認して再試行してください。",
  "The game has not started.": "ゲームはまだ開始していません。",
  "The computer controls its own turn.": "コンピューターは自分のターンを自動で操作します。",
  "Only the active player may choose a build.": "建設を選べるのは手番プレイヤーだけです。",
  "Finish the current phase before choosing a build.": "建設を選ぶ前に現在のフェーズを完了してください。",
  "Choose a valid build.": "有効な建設を選んでください。",
  "Not enough resources for this build.": "この建設に必要な資源が足りません。",
  "The shared board can only place pieces or move the robber. Use the active player's phone for other actions.": "共有盤面ではコマの配置と盗賊の移動だけができます。その他の操作は手番プレイヤーのスマートフォンで行ってください。",
  "Choose a highlighted board target for the current build or phase.": "現在の建設またはフェーズに対応する、盤面上の強調表示された場所を選んでください。",
  "This connection is not bound to an admitted player.": "この接続は承認済みのプレイヤーに紐づいていません。",
  "Place pieces and move the robber on the shared board, not a phone.": "コマの配置と盗賊の移動はスマートフォンではなく共有盤面で行ってください。",
  "The action could not be applied.": "操作を適用できませんでした。",
  "Invalid network message.": "ネットワークメッセージが無効です。",
  "Network message is too large.": "ネットワークメッセージが大きすぎます。",
  "Invalid game action.": "ゲーム操作が無効です。",
  "Invalid game action or unexpected fields.": "ゲーム操作が無効か、予期しない項目が含まれています。",
  "Invalid network message or unexpected fields.": "ネットワークメッセージが無効か、予期しない項目が含まれています。",
  "The host sent an invalid network message.": "ホストから無効なネットワークメッセージが届きました。",
  "PeerJS signaling timed out. Check internet access; reconnecting automatically.": "PeerJSのシグナリングがタイムアウトしました。インターネット接続を確認してください。自動的に再接続します。",
  "PeerJS signaling disconnected. Existing local connections may continue; reconnecting automatically.": "PeerJSのシグナリングが切断されました。既存のローカル接続は継続できる場合があります。自動的に再接続します。",
  "The target device is unavailable through PeerJS signaling. Keep both pages open and use the host's latest invitation.": "PeerJSのシグナリングで相手の端末に接続できません。両方のページを開いたまま、ホストの最新の招待を使用してください。",
  "PeerJS connection failed ({failureType}). Check internet access and keep both pages open.": "PeerJSの接続に失敗しました（{failureType}）。インターネット接続を確認し、両方のページを開いたままにしてください。",
  "PeerJS signaling closed unexpectedly. Reconnecting automatically.": "PeerJSのシグナリングが予期せず終了しました。自動的に再接続します。",
  "Unable to reconnect to PeerJS signaling. Check internet access.": "PeerJSのシグナリングに再接続できません。インターネット接続を確認してください。",
  "The computer could not finish its move.": "コンピューターが操作を完了できませんでした。",
  "This seat reconnected on another connection. This old connection is no longer authorized.": "この参加枠は別の接続で再接続されました。古い接続では操作できません。",
  "Join this room before sending commands.": "操作を送信する前にこのルームに参加してください。",
  "The operation failed.": "操作に失敗しました。",
  "The game could not be started.": "ゲームを開始できませんでした。",
  "That action is not available.": "その操作はできません。",
  "The game started before you were admitted.": "承認される前にゲームが開始されました。",
  "The host declined your join request.": "ホストが参加申請を拒否しました。",
  "The host removed you from the lobby. Use Reconnect to request a new seat.": "ホストがあなたをロビーから削除しました。「再接続」で新たに参加申請してください。",
  "Session storage is blocked. Refreshing this page will lose your seat credential.": "セッションストレージがブロックされています。ページを再読み込みすると参加枠の認証情報が失われます。",
  "Connection to the host was lost. Keep both pages open. Reconnecting automatically.": "ホストとの接続が失われました。両方のページを開いたままにしてください。自動的に再接続します。",
  "Connection to the host was lost. Keep both pages open. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.": "ホストとの接続が失われました。両方のページを開いたままにしてください。接続の詳細: ICE {iceState}、収集 {gatheringState}。自動的に再接続します。",
  "Timed out waiting for the host's connection answer. Keep the host page open and use its latest invitation. Reconnecting automatically.": "ホストの接続応答を待機中にタイムアウトしました。ホストのページを開いたまま、最新の招待を使用してください。自動的に再接続します。",
  "Timed out waiting for the host's connection answer. Keep the host page open and use its latest invitation. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.": "ホストの接続応答を待機中にタイムアウトしました。ホストのページを開いたまま、最新の招待を使用してください。接続の詳細: ICE {iceState}、収集 {gatheringState}。自動的に再接続します。",
  "Connected to the host, but timed out waiting for the initial game state. Keep the host page active. Reconnecting automatically.": "ホストに接続しましたが、最初のゲーム状態を待機中にタイムアウトしました。ホストのページをアクティブにしてください。自動的に再接続します。",
  "Connected to the host, but timed out waiting for the initial game state. Keep the host page active. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.": "ホストに接続しましたが、最初のゲーム状態を待機中にタイムアウトしました。ホストのページをアクティブにしてください。接続の詳細: ICE {iceState}、収集 {gatheringState}。自動的に再接続します。",
  "The host answered, but the direct WebRTC connection timed out. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured. Reconnecting automatically.": "ホストは応答しましたが、WebRTCの直接接続がタイムアウトしました。端末のファイアウォール、VPN、ルーターの端末間通信制限を確認してください。中継サーバーへの切り替えは設定されていません。自動的に再接続します。",
  "The host answered, but the direct WebRTC connection timed out. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.": "ホストは応答しましたが、WebRTCの直接接続がタイムアウトしました。端末のファイアウォール、VPN、ルーターの端末間通信制限を確認してください。中継サーバーへの切り替えは設定されていません。接続の詳細: ICE {iceState}、収集 {gatheringState}。自動的に再接続します。",
  "The direct WebRTC connection failed or was interrupted. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured. Reconnecting automatically.": "WebRTCの直接接続に失敗したか、接続が中断されました。端末のファイアウォール、VPN、ルーターの端末間通信制限を確認してください。中継サーバーへの切り替えは設定されていません。自動的に再接続します。",
  "The direct WebRTC connection failed or was interrupted. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.": "WebRTCの直接接続に失敗したか、接続が中断されました。端末のファイアウォール、VPN、ルーターの端末間通信制限を確認してください。中継サーバーへの切り替えは設定されていません。接続の詳細: ICE {iceState}、収集 {gatheringState}。自動的に再接続します。",
  "The host sent an invalid network message. Reconnect only to a trusted host.": "ホストから無効なネットワークメッセージが届きました。信頼できるホストにだけ再接続してください。",
  "Session storage is blocked. The old seat credential could not be cleared.": "セッションストレージがブロックされています。古い参加枠の認証情報を削除できませんでした。",
  "Wait until the host admits your connected phone.": "ホストが接続中のスマートフォンを承認するまでお待ちください。",
  "Invalid action.": "操作が無効です。",
  "The host did not confirm the command. Reconnecting to obtain the authoritative state; the command will not be replayed.": "ホストが操作を確認しませんでした。正しい状態を取得するため再接続します。この操作は再送されません。",
  "The command could not reach the host. Reconnecting automatically.": "操作をホストに送信できませんでした。自動的に再接続します。",
  "Only the shared host can manage the lobby or start the game.": "ロビーの管理とゲームの開始ができるのは共有ホストだけです。",
  "Reconnecting to the host.": "ホストに再接続しています。",
} as const;

export type GameMessage = { key: keyof typeof gameMessages; parameters?: TranslationParameters };

const developmentNames: Record<DevelopmentKind, string> = {
  knight: "騎士", "victory-point": "勝利点", "road-building": "街道建設", "year-of-plenty": "収穫", monopoly: "独占",
};
const awardNames = { "Longest Road": "最長交易路", "Longest Route": "最長交易路", "Largest Army": "最大騎士力" } as const;
const resourceNames: Resource[] = ["wood", "brick", "wool", "grain", "ore"];

export function formatGameMessage(language: Language, message: GameMessage): string {
  const parameters = { ...message.parameters };
  if (language === "ja") {
    for (const name of ["resource", "give", "receive"]) {
      if (resourceNames.includes(parameters[name] as Resource)) parameters[name] = resourceName(language, parameters[name] as Resource);
    }
    if (typeof parameters.kind === "string" && Object.hasOwn(developmentNames, parameters.kind)) parameters.kind = developmentNames[parameters.kind as DevelopmentKind];
    if (typeof parameters.award === "string" && Object.hasOwn(awardNames, parameters.award)) parameters.award = awardNames[parameters.award as keyof typeof awardNames];
  }
  return translate(language, gameMessages, message.key, parameters);
}

export class GameError extends Error {
  readonly gameMessage: GameMessage;

  constructor(key: GameMessage["key"], parameters?: TranslationParameters) {
    const gameMessage: GameMessage = parameters ? { key, parameters } : { key };
    super(formatGameMessage("en", gameMessage));
    this.name = "GameError";
    this.gameMessage = gameMessage;
  }
}

export function gameErrorMessage(error: unknown, fallback: GameMessage["key"] = "The operation failed."): GameMessage {
  return error instanceof GameError ? error.gameMessage : { key: fallback };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validParameter(name: string, value: unknown): boolean {
  switch (name) {
    case "player": case "victim": case "other": return typeof value === "string" && value.length >= 1 && value.length <= 80 && !/\p{C}/u.test(value);
    case "resource": case "give": case "receive": return resourceNames.includes(value as Resource);
    case "award": return typeof value === "string" && Object.hasOwn(awardNames, value);
    case "kind": return typeof value === "string" && Object.hasOwn(developmentNames, value);
    case "first": case "second": return integer(value, 1, 6);
    case "total": return integer(value, 2, 12);
    case "count": return integer(value, 0, 95);
    case "points": return integer(value, 0, 30);
    case "ratio": return integer(value, 2, 4);
    case "failureType": return typeof value === "string" && /^[a-z-]{1,80}$/.test(value);
    case "iceState": return ["new", "checking", "connected", "completed", "disconnected", "failed", "closed"].includes(value as string);
    case "gatheringState": return ["new", "gathering", "complete"].includes(value as string);
    default: return false;
  }
}

export function isGameMessage(value: unknown): value is GameMessage {
  if (!record(value) || !Object.hasOwn(value, "key") || typeof value.key !== "string" || !Object.hasOwn(gameMessages, value.key) ||
    Object.keys(value).some(key => key !== "key" && key !== "parameters")) return false;
  const names = [...value.key.matchAll(/\{(\w+)\}/g)].map(match => match[1]!);
  if (!Object.hasOwn(value, "parameters")) return names.length === 0;
  const parameters = value.parameters;
  return record(parameters) && Object.keys(parameters).length === names.length &&
    names.every(name => Object.hasOwn(parameters, name) && validParameter(name, parameters[name]));
}
