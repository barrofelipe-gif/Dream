import "server-only";
import { TelegramClient, Api, utils } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { Logger } from "teleproto/extensions";
import bigInt from "big-integer";
import {
  TelegramError,
  type Group,
  type Person,
  type Privacy,
  type GroupSearch,
  type PublicGroup,
} from "./domain";

export type Credentials = { apiId: number; apiHash: string };
class QuietLogger extends Logger {
  override log() {}
  override _log() {}
}
export function credentials(input: Record<string, unknown>): Credentials {
  if (
    typeof input.api_id !== "number" ||
    !Number.isInteger(input.api_id) ||
    input.api_id <= 0 ||
    input.api_id >= 2 ** 31 ||
    typeof input.api_hash !== "string" ||
    !/^[a-f0-9]{32}$/i.test(input.api_hash)
  )
    throw new TelegramError(
      "credentials",
      "Informe o API ID numérico e o API Hash de 32 caracteres de my.telegram.org.",
    );
  return { apiId: input.api_id, apiHash: input.api_hash };
}
export function mapError(error: unknown): TelegramError {
  if (error instanceof TelegramError) return error;
  const e = error as {
    errorMessage?: string;
    seconds?: number;
    message?: string;
    name?: string;
  };
  const code = e?.errorMessage || "";
  if (/QUERY_TOO_SHORT|SEARCH_QUERY_EMPTY/.test(code))
    return new TelegramError(
      "input",
      "Tente uma pesquisa mais específica, com pelo menos 3 caracteres.",
    );
  if (/USERNAME_INVALID|USERNAME_NOT_OCCUPIED/.test(code))
    return new TelegramError(
      "group_not_found",
      "Não encontramos um grupo público com esse @usuário. Confira o nome ou pesquise por assunto.",
      0,
      404,
    );
  if (code === "INVITE_REQUEST_SENT")
    return new TelegramError(
      "join_pending",
      "O pedido de entrada foi enviado. Aguarde a aprovação dos administradores no Telegram antes de preparar a origem novamente.",
      0,
      409,
    );
  if (code === "CHANNELS_TOO_MUCH")
    return new TelegramError(
      "join_limit",
      "Sua conta atingiu o limite de grupos e canais do Telegram. Revise suas participações no aplicativo oficial.",
      0,
      409,
    );
  if (code === "USER_BANNED_IN_CHANNEL")
    return new TelegramError(
      "permission",
      "O Telegram não permite a entrada desta conta no grupo. Confira a situação no aplicativo oficial.",
      0,
      409,
    );
  if (/FLOOD_WAIT|SLOWMODE_WAIT/.test(code) || e?.seconds)
    return new TelegramError(
      "flood_wait",
      "O Telegram solicitou uma espera. Retome manualmente após o prazo.",
      Math.max(1, e.seconds || 60),
      409,
    );
  if (/PEER_FLOOD|FROZEN|USER_RESTRICTED/.test(code))
    return new TelegramError(
      "restricted",
      "O Telegram restringiu a conta. Novas inclusões foram interrompidas.",
      0,
      409,
    );
  if (/SESSION_PASSWORD_NEEDED/.test(code))
    return new TelegramError(
      "password_required",
      "Digite a senha de duas etapas da sua conta.",
      0,
      409,
    );
  if (/PASSWORD_HASH_INVALID/.test(code))
    return new TelegramError("password", "Senha de duas etapas incorreta.");
  if (/PHONE_CODE_EXPIRED/.test(code))
    return new TelegramError(
      "code",
      "O código expirou. Cancele e inicie outra conexão.",
    );
  if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(code))
    return new TelegramError(
      "code",
      "Código inválido. Confira o código recebido no Telegram.",
    );
  if (/API_ID_INVALID|API_ID_PUBLISHED/.test(code))
    return new TelegramError(
      "credentials",
      "Confira seu API ID e API Hash em my.telegram.org.",
    );
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED/.test(code))
    return new TelegramError(
      "auth_required",
      "Sua sessão expirou. Reconecte o Telegram no painel.",
      0,
      409,
    );
  if (
    /USER_PRIVACY_RESTRICTED|USER_NOT_MUTUAL_CONTACT|USER_CHANNELS_TOO_MUCH/.test(
      code,
    )
  )
    return new TelegramError(
      "privacy",
      "A inclusão foi recusada por privacidade ou condição da conta.",
      0,
      409,
    );
  if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|CHANNEL_PRIVATE/.test(code))
    return new TelegramError(
      "permission",
      "O Telegram recusou a operação por falta de acesso ou permissão no grupo.",
      0,
      409,
    );
  if (/PHONE_NUMBER|EMAIL_|CAPTCHA/.test(code))
    return new TelegramError(
      "login",
      "O Telegram exige uma verificação adicional. Confira sua conta no aplicativo oficial.",
      0,
      409,
    );
  return new TelegramError(
    "uncertain",
    "A conexão não foi concluída. Confira o resultado antes de repetir.",
    0,
    409,
  );
}
export async function deadline<T>(
  work: Promise<T>,
  milliseconds = 25000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new TelegramError(
                "uncertain",
                "A conexão demorou demais. Confira o resultado antes de repetir.",
                0,
                409,
              ),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class TelegramDriver {
  readonly session: StringSession;
  readonly client: TelegramClient;
  constructor(
    readonly credentials: Credentials,
    session = "",
  ) {
    this.session = new StringSession(session);
    this.client = new TelegramClient(
      this.session,
      credentials.apiId,
      credentials.apiHash,
      {
        requestRetries: 1,
        connectionRetries: 1,
        reconnectRetries: 0,
        autoReconnect: false,
        retryDelay: 500,
        floodSleepThreshold: 0,
        baseLogger: new QuietLogger(),
        deviceModel: "BFF Fitness · Growth",
        appVersion: "1.0",
        langCode: "pt",
        systemLangCode: "pt-BR",
      },
    );
  }
  async connect(required = true) {
    await deadline(this.client.connect());
    if (required && !(await deadline(this.client.checkAuthorization())))
      throw new TelegramError(
        "auth_required",
        "Reconecte sua conta do Telegram.",
        0,
        409,
      );
  }
  async close() {
    await deadline(this.client.destroy(), 5000).catch(() => undefined);
  }
  save() {
    return this.session.save();
  }
  async me() {
    const user = await this.client.getMe();
    if (!(user instanceof Api.User))
      throw new TelegramError("auth_required", "Conta não conectada.");
    return {
      id: Number(user.id.toString()),
      name: [user.firstName, user.lastName]
        .filter(Boolean)
        .join(" ")
        .slice(0, 200),
      username: user.username || "",
    };
  }
  private(entity: Api.Chat | Api.Channel) {
    return (
      !(entity instanceof Api.Channel) ||
      !(entity.username || entity.usernames?.some((u) => u.active))
    );
  }
  groupInfo(entity: Api.Chat | Api.Channel): Group {
    return {
      id: Number(utils.getPeerId(entity)),
      name: entity.title.slice(0, 100),
      private: this.private(entity),
      owner: !!entity.creator,
      can_invite: !!(entity.creator || entity.adminRights?.inviteUsers),
      supergroup: entity instanceof Api.Channel,
    };
  }
  async groups() {
    const dialogs = await this.client.getDialogs({});
    return dialogs.flatMap((d) => {
      const e = d.entity;
      if (!(e instanceof Api.Chat) && !(e instanceof Api.Channel)) return [];
      if (e instanceof Api.Channel && !e.megagroup) return [];
      if (e.left || (e instanceof Api.Chat && e.deactivated)) return [];
      return [this.groupInfo(e)];
    });
  }
  publicGroup(
    entity: Api.TypeChat,
    sponsored = false,
    includeChannels = false,
  ): PublicGroup | undefined {
    if (
      !(entity instanceof Api.Channel) ||
      (!entity.megagroup && !(includeChannels && entity.broadcast)) ||
      (!includeChannels && entity.broadcast) ||
      entity.scam ||
      entity.fake
    )
      return;
    const username =
      entity.username || entity.usernames?.find((u) => u.active)?.username;
    const id = Number(utils.getPeerId(entity));
    if (
      !username ||
      !/^[A-Za-z0-9_]{3,32}$/.test(username) ||
      !Number.isSafeInteger(id)
    )
      return;
    const count = entity.participantsCount;
    return {
      id,
      name: entity.title.slice(0, 200),
      username,
      url: `https://t.me/${username}`,
      members:
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0
          ? count
          : null,
      sponsored,
      ...(includeChannels ? { kind: entity.broadcast ? "channel" as const : "group" as const } : {}),
    };
  }
  async searchGroups(query: GroupSearch, includeChannels = false): Promise<PublicGroup[]> {
    if (query.username) {
      const resolved = await this.client.invoke(
        new Api.contacts.ResolveUsername({ username: query.username }),
      );
      if (!(resolved.peer instanceof Api.PeerChannel)) return [];
      const channelId = resolved.peer.channelId;
      const entity = resolved.chats.find(
        (c) => c instanceof Api.Channel && c.id.equals(channelId),
      );
      const group = entity && this.publicGroup(entity, false, includeChannels);
      return group ? [group] : [];
    }
    const found = await this.client.invoke(
      new Api.contacts.Search({ q: query.text, limit: 30 }),
    );
    const ads = await this.client.invoke(
      new Api.contacts.GetSponsoredPeers({ q: query.text }),
    );
    const sponsored =
      ads instanceof Api.contacts.SponsoredPeers ? ads : undefined;
    const chats = [...found.chats, ...(sponsored?.chats || [])];
    const results: PublicGroup[] = [],
      seen = new Set<number>();
    const add = (peers: Api.TypePeer[], isAd: boolean) => {
      for (const peer of peers) {
        if (!(peer instanceof Api.PeerChannel)) continue;
        const entity = chats.find(
          (c) => c instanceof Api.Channel && c.id.equals(peer.channelId),
        );
        const group = entity && this.publicGroup(entity, isAd, includeChannels);
        if (group && !seen.has(group.id)) {
          seen.add(group.id);
          results.push(group);
        }
      }
    };
    add(found.myResults, false);
    add(sponsored?.peers.map((p) => p.peer) || [], true);
    add(found.results, false);
    return results.slice(0, 30);
  }
  async inspectPublicGroup(username: string, expectedId: number): Promise<PublicGroup> {
    const handle = username.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,32}$/.test(handle) ||
        !Number.isSafeInteger(expectedId) || expectedId >= 0)
      throw new TelegramError("input", "Escolha um grupo ou canal público salvo válido.");
    const resolved = await this.client.invoke(
      new Api.contacts.ResolveUsername({ username: handle }),
    );
    if (!(resolved.peer instanceof Api.PeerChannel))
      throw new TelegramError("group_identity", "Este @usuário não pertence mais ao grupo ou canal salvo.");
    const channelId = resolved.peer.channelId;
    const entity = resolved.chats.find(
      (chat): chat is Api.Channel => chat instanceof Api.Channel && chat.id.equals(channelId),
    );
    if (!entity)
      throw new TelegramError("group_identity", "O Telegram não confirmou o grupo ou canal salvo.");
    const group = this.publicGroup(entity, false, true);
    if (!group || group.id !== expectedId)
      throw new TelegramError("group_identity", "Este @usuário pertence a outro ID ou deixou de ser público. O histórico foi preservado.");
    const full = await this.client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
    if (!(full.fullChat instanceof Api.ChannelFull) || !full.fullChat.id.equals(entity.id))
      throw new TelegramError("group_identity", "O Telegram não confirmou a identidade do grupo ou canal salvo.");
    const fresh = full.chats.find(
      (chat): chat is Api.Channel => chat instanceof Api.Channel && chat.id.equals(entity.id),
    );
    const current = fresh && this.publicGroup(fresh, false, true);
    if (!current || current.id !== expectedId)
      throw new TelegramError("group_identity", "O grupo ou canal salvo deixou de estar público. O histórico foi preservado.");
    const members = full.fullChat.participantsCount;
    return { ...current, members: typeof members === "number" && Number.isSafeInteger(members) && members >= 0 ? members : null };
  }
  async prepareOrigin(username: string, expectedId: number, beforeJoin?: () => Promise<unknown>): Promise<Group> {
    const handle = username.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,32}$/.test(handle) ||
        !Number.isSafeInteger(expectedId) || expectedId >= 0)
      throw new TelegramError("input", "Escolha um grupo público descoberto válido.");
    const resolved = await this.client.invoke(new Api.contacts.ResolveUsername({ username: handle }));
    if (!(resolved.peer instanceof Api.PeerChannel))
      throw new TelegramError("group_identity", "Este @usuário não pertence mais ao grupo descoberto.");
    const channelId = resolved.peer.channelId;
    const entity = resolved.chats.find(
      (chat): chat is Api.Channel => chat instanceof Api.Channel && chat.id.equals(channelId),
    );
    const current = entity && this.publicGroup(entity, false, true);
    if (!entity || !current || current.id !== expectedId)
      throw new TelegramError("group_identity", "O Telegram não confirmou a identidade pública do grupo. Pesquise novamente.");
    if (!entity.megagroup || entity.broadcast)
      throw new TelegramError("origin_kind", "Este público é um canal. A coleta atual aceita somente grupos e supergrupos.", 0, 409);
    const selfMember = async () => {
      try {
        const result = await this.client.invoke(new Api.channels.GetParticipant({ channel: entity, participant: new Api.InputPeerSelf() }));
        const participant = result.participant;
        return participant instanceof Api.ChannelParticipant ||
          participant instanceof Api.ChannelParticipantSelf ||
          participant instanceof Api.ChannelParticipantCreator ||
          participant instanceof Api.ChannelParticipantAdmin ||
          (participant instanceof Api.ChannelParticipantBanned && !participant.left && !participant.bannedRights.viewMessages);
      } catch (error) {
        if ((error as { errorMessage?: string })?.errorMessage === "USER_NOT_PARTICIPANT") return false;
        throw error;
      }
    };
    if (entity.left || !(await selfMember())) {
      // A timed-out/cancelled caller must not start a later membership change.
      if (beforeJoin) await beforeJoin();
      try {
        const joined = await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }), undefined, {
          maxRetryCount: 0, floodSleepThreshold: 0, timeout: 15000,
        });
        if (joined instanceof Api.messages.ChatInviteJoinResultWebView)
          throw new TelegramError("join_verification", "O Telegram exige uma verificação de entrada. Conclua pelo aplicativo oficial e prepare a origem novamente.", 0, 409);
      } catch (error) {
        if ((error as { errorMessage?: string })?.errorMessage !== "USER_ALREADY_PARTICIPANT") throw error;
      }
      if (!(await selfMember()))
        throw new TelegramError(
          entity.joinRequest ? "join_pending" : "join_unconfirmed",
          entity.joinRequest
            ? "A participação ainda não foi aprovada pelos administradores. Confira o pedido no Telegram."
            : "O Telegram ainda não confirmou sua participação. Confira o grupo no aplicativo oficial antes de repetir.",
          0,
          409,
        );
    }
    return this.groupInfo(entity);
  }
  async group(id: number, invite = false) {
    const dialogs = await this.client.getDialogs({});
    const entity = dialogs
      .map((d) => d.entity)
      .find(
        (e) =>
          e &&
          (e instanceof Api.Chat || e instanceof Api.Channel) &&
          Number(utils.getPeerId(e)) === id,
      );
    if (!(entity instanceof Api.Chat) && !(entity instanceof Api.Channel))
      throw new TelegramError(
        "permission",
        "Grupo não encontrado nos diálogos da sua conta.",
      );
    if (entity instanceof Api.Channel && !entity.megagroup)
      throw new TelegramError(
        "permission",
        "Este painel trabalha com grupos e supergrupos.",
      );
    if (
      invite &&
      (!this.private(entity) ||
        !(entity.creator || entity.adminRights?.inviteUsers))
    )
      throw new TelegramError(
        "permission",
        "O destino precisa ser privado e permitir convites pela conta conectada.",
      );
    return entity;
  }
  person(user: Api.User): Person {
    return {
      user_id: Number(user.id.toString()),
      name: [user.firstName, user.lastName]
        .filter(Boolean)
        .join(" ")
        .slice(0, 200),
      username: user.username || "",
      accessHash: user.accessHash?.toString() || "0",
    };
  }
  input(person: Person) {
    return new Api.InputUser({
      userId: bigInt(person.user_id),
      accessHash: bigInt(person.accessHash),
    });
  }
  async member(group: Api.Chat | Api.Channel, user: Api.TypeEntityLike) {
    try {
      if (group instanceof Api.Channel) {
        const r = await this.client.invoke(
          new Api.channels.GetParticipant({
            channel: group,
            participant: user,
          }),
        );
        const p = r.participant;
        return (
          !(p instanceof Api.ChannelParticipantLeft) &&
          (!(p instanceof Api.ChannelParticipantBanned) ||
            (!p.left && !p.bannedRights.viewMessages))
        );
      }
      const r = await this.client.invoke(
        new Api.messages.GetFullChat({ chatId: group.id }),
      );
      const participantId =
        user instanceof Api.InputUser
          ? user.userId.toString()
          : user instanceof Api.User
            ? user.id.toString()
            : "";
      return (
        r.fullChat instanceof Api.ChatFull &&
        r.fullChat.participants instanceof Api.ChatParticipants &&
        r.fullChat.participants.participants.some(
          (p) => p.userId.toString() === participantId,
        )
      );
    } catch (error) {
      if (
        (error as { errorMessage?: string })?.errorMessage ===
        "USER_NOT_PARTICIPANT"
      )
        return false;
      throw error;
    }
  }
  async collect(sourceId: number, targetId: number) {
    const source = await this.group(sourceId);
    await this.group(targetId, true);
    const found: Person[] = [];
    for await (const user of this.client.iterParticipants(source, {
      limit: 500,
    })) {
      if (user instanceof Api.User && !user.bot && !user.deleted)
        found.push(this.person(user));
    }
    return found;
  }
  async privacy(id: number): Promise<Privacy> {
    const e = await this.group(id);
    const full =
      e instanceof Api.Channel
        ? (
            await this.client.invoke(
              new Api.channels.GetFullChannel({ channel: e }),
            )
          ).fullChat
        : undefined;
    return {
      group_id: id,
      name: e.title.slice(0, 100),
      private: this.private(e),
      owner: !!e.creator,
      supergroup: e instanceof Api.Channel,
      members_hidden:
        full instanceof Api.ChannelFull && !!full.participantsHidden,
      content_protected: !!e.noforwards,
      checked_at: Date.now() / 1000,
      notes:
        full instanceof Api.ChannelFull && full.linkedChatId
          ? [
              "Este grupo está vinculado a outro chat. Revise o acesso pela discussão e os convites no Telegram.",
            ]
          : [],
    };
  }
  async protect(id: number) {
    const e = await this.group(id);
    if (!e.creator)
      throw new TelegramError(
        "permission",
        "Conecte a conta proprietária para aplicar as proteções.",
      );
    const notes: string[] = [];
    const before = await this.privacy(id);
    if (e instanceof Api.Channel) {
      if (e.username)
        await this.client.invoke(
          new Api.channels.UpdateUsername({ channel: e, username: "" }),
        );
      if (e.usernames?.some((u) => u.active))
        await this.client.invoke(
          new Api.channels.DeactivateAllUsernames({ channel: e }),
        );
      if (!before.members_hidden)
        try {
          await this.client.invoke(
            new Api.channels.ToggleParticipantsHidden({
              channel: e,
              enabled: true,
            }),
          );
        } catch (error) {
          const code = (error as { errorMessage?: string }).errorMessage;
          if (code === "PARTICIPANTS_TOO_FEW")
            notes.push(
              "O Telegram ainda não permite ocultar membros neste tamanho de grupo.",
            );
          else if (code !== "CHAT_NOT_MODIFIED") throw error;
        }
    } else
      notes.push(
        "Ocultar membros exige um supergrupo. Converta o grupo no Telegram para habilitar a opção.",
      );
    if (!before.content_protected)
      await this.client
        .invoke(new Api.messages.ToggleNoForwards({ peer: e, enabled: true }))
        .catch((error) => {
          if (
            (error as { errorMessage?: string }).errorMessage !==
            "CHAT_NOT_MODIFIED"
          )
            throw error;
        });
    const result = await this.privacy(id);
    result.notes = [...(result.notes || []), ...notes];
    return result;
  }
  async invite(sourceId: number, targetId: number, person: Person) {
    await this.group(sourceId);
    const target = await this.group(targetId, true);
    const user = this.input(person);
    if (await this.member(target, user))
      return {
        state: "already",
        message:
          "Participação no destino já confirmada. Nenhum convite enviado.",
      };
    const result =
      target instanceof Api.Channel
        ? await this.client.invoke(
            new Api.channels.InviteToChannel({
              channel: target,
              users: [user],
            }),
          )
        : await this.client.invoke(
            new Api.messages.AddChatUser({
              chatId: target.id,
              userId: user,
              fwdLimit: 0,
            }),
          );
    if (
      "missingInvitees" in result &&
      result.missingInvitees.some(
        (p) => p.userId.toString() === String(person.user_id),
      )
    )
      return {
        state: "privacy",
        message: "O Telegram informou que o participante não foi adicionado.",
      };
    if (!(await this.member(target, user)))
      throw new TelegramError(
        "uncertain",
        "Solicitação enviada, mas participação não confirmada. Confira no Telegram antes de repetir.",
        0,
        409,
      );
    return {
      state: "added",
      message: "Inclusão confirmada por consulta à participação no destino.",
    };
  }
}
