import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { useEntitlement } from "@/billing/entitlements";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Switch } from "@/motion/Switch";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input, Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import type { GroupKind } from "@/social/contract";
import { useCloudSession } from "@/cloud/session";
import { checkInvite, clearInvite, closeSheet, createGroup, joinGroup, useSocial } from "@/social/store";
import { GROUP_KIND_HINT, GROUP_KIND_LABEL, GROUPS, ROLE_LABEL } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";

/** New group: name, kind (peer group / mentoring / team), description. */
export function CreateGroupSheet() {
  const open = useSocial((s) => s.sheet?.kind === "create");
  const onClose = closeSheet;
  const [kind, setKind] = useState<GroupKind>("group");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [shake, setShake] = useState(0);
  const busy = useSocial((s) => s.busy);
  const mentorOk = useEntitlement("mentor");
  const nameId = useId();
  const descId = useId();
  const submit = async () => {
    if (name.trim().length < 2) {
      setShake((n) => n + 1);
      return;
    }
    const g = await createGroup(kind, name.trim(), desc.trim());
    if (g) {
      setName("");
      setDesc("");
      setKind("group");
      onClose();
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={GROUPS.createTitle}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={busy === "createGroup"} data-testid="group-create-submit">
            {GROUPS.createAction}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <StaggerItem className="grid gap-2">
          <span className="label">{GROUPS.kind}</span>
          <Segmented<GroupKind>
            aria-label={GROUPS.kind}
            options={(["group", "mentor", "team"] as const).map((k) => ({ v: k, label: GROUP_KIND_LABEL[k] }))}
            value={kind}
            onChange={setKind}
          />
          <p className="text-[12.5px] leading-snug text-mute">
            {GROUP_KIND_HINT[kind]}
            {kind === "mentor" && !mentorOk ? " Mentoring gehört zu Premium." : ""}
          </p>
        </StaggerItem>
        <StaggerItem>
          <Field label={GROUPS.name} htmlFor={nameId} invalidKey={shake || null} error={shake && name.trim().length < 2 ? "Mindestens 2 Zeichen." : undefined}>
            <Input id={nameId} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={GROUPS.namePlaceholder} data-testid="group-name" />
          </Field>
        </StaggerItem>
        <StaggerItem>
          <Field label={GROUPS.description} htmlFor={descId}>
            <Textarea id={descId} value={desc} maxLength={280} rows={3} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </StaggerItem>
      </div>
    </Sheet>
  );
}

/**
 * Join by code (typed in, or from an invitation link): the code is checked first and the sheet shows WHERE the user is
 * about to go (group, role, size) and asks the one privacy question – share my figures? – before anything happens.
 */
export function JoinSheet() {
  const reduced = useReducedFx();
  const invite = useSocial((s) => s.invite);
  const asked = useSocial((s) => s.sheet?.kind === "join");
  // an invitation from the URL opens the sheet by itself – once the login sheet is gone (never two dialogs at once)
  const authOpen = useCloudSession((s) => s.sheet.open);
  const open = asked || (!!invite?.code && !authOpen);
  const onClose = closeSheet;
  const busy = useSocial((s) => s.busy);
  const [code, setCode] = useState(invite?.code ?? "");
  const [share, setShare] = useState(false);
  const codeId = useId();
  const shareId = useId();
  useEffect(() => {
    if (open && invite?.code && !invite.preview && invite.load === "idle") void checkInvite(invite.code);
  }, [open, invite]);
  const preview = invite?.preview ?? null;
  const close = () => {
    clearInvite();
    setCode("");
    onClose();
  };
  const join = async () => {
    if (!preview) return;
    if (await joinGroup(preview.code, share ? "stats" : "none")) {
      setCode("");
      onClose();
    }
  };
  const typed = (code || invite?.code || "").toUpperCase();
  return (
    <Sheet
      open={open}
      onClose={close}
      title={GROUPS.joinTitle}
      dismissGuard={false}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={close}>Abbrechen</Button>
          <Button variant="primary" onClick={join} disabled={!preview || preview.member || busy === "join"} data-testid="join-submit">
            {GROUPS.joinAction}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <StaggerItem>
          <Field label={GROUPS.code} htmlFor={codeId} error={invite?.error?.message}>
            <div className="flex gap-2">
              <Input
                id={codeId}
                value={typed}
                maxLength={10}
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                placeholder={GROUPS.codePlaceholder}
                className="font-mono tracking-[0.18em]"
                wrapperClassName="flex-1"
                data-testid="join-code"
              />
              <Button onClick={() => void checkInvite(typed)} disabled={typed.length !== 10 || invite?.load === "loading"} data-testid="join-check">
                {GROUPS.check}
              </Button>
            </div>
          </Field>
        </StaggerItem>
        <AnimatePresence initial={false}>
          {preview && (
            <motion.div
              key={preview.code}
              className="grid gap-3 rounded-2xl border border-line-2 bg-ink-900 p-4"
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ default: spring.pop, opacity: tween.fade }}
              data-testid="join-preview"
            >
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                <Glyph name="users" className="size-3.5" />
                {GROUP_KIND_LABEL[preview.kind]}
              </span>
              <span className="text-[17px] font-semibold tracking-tight">{GROUPS.invitedTo(preview.groupName)}</span>
              <span className="text-[12.5px] text-mute">{GROUPS.inviteRole(ROLE_LABEL[preview.role], preview.members)}</span>
              {preview.member ? (
                <span className="text-[12.5px] text-win">{GROUPS.alreadyMember}</span>
              ) : (
                <div className={cn("flex items-start justify-between gap-4 border-t border-line pt-3")}>
                  <span className="grid gap-0.5">
                    <label htmlFor={shareId} className="text-[13.5px]">
                      {GROUPS.shareOnJoin}
                    </label>
                    <span className="text-[12px] text-mute">{GROUPS.shareOnJoinHint}</span>
                  </span>
                  <Switch id={shareId} checked={share} onCheckedChange={setShare} tone="win" />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
