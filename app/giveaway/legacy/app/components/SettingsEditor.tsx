import type { CampaignSettings } from "../lib/settings";
import {
  Check,
  Select,
  NumberInput,
  RowCard,
  TextArea,
  TextInput,
  list,
} from "./fields";

// Stores Campaign.settings only; the winner email, discounts, Klaviyo sync
// and webhook delivery read these elsewhere.
export function SettingsEditor(props: {
  settings: CampaignSettings;
  onChange: (settings: CampaignSettings) => void;
}) {
  const s = props.settings;
  const set = (patch: Partial<CampaignSettings>) =>
    props.onChange({ ...s, ...patch });
  const winner = (patch: Partial<CampaignSettings["winnerEmail"]>) =>
    set({ winnerEmail: { ...s.winnerEmail, ...patch } });
  const consolation = (patch: Partial<CampaignSettings["consolation"]>) =>
    set({ consolation: { ...s.consolation, ...patch } });
  const klaviyo = (patch: Partial<CampaignSettings["klaviyo"]>) =>
    set({ klaviyo: { ...s.klaviyo, ...patch } });
  const daily = (patch: Partial<CampaignSettings["daily"]>) =>
    set({ daily: { ...s.daily, ...patch } });
  const sources = s.daily.sources;

  return (
    <>
      <s-section heading="Daily draw">
        <s-stack gap="base">
          <Check
            label="Give away a different product every day"
            checked={s.daily.enabled}
            details="Each day the app picks an in-stock product that matches the rules below and reserves one in Shopify so it can't sell. At the draw time one winner is drawn from the entries earned that day, and tomorrow's prize is picked."
            onChange={(enabled) => daily({ enabled })}
          />
          {s.daily.enabled && (
            <>
              <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                <TextInput
                  label="Draw time"
                  value={s.daily.drawTime}
                  placeholder="21:00"
                  details="24-hour time in the giveaway's timezone."
                  onChange={(drawTime) => daily({ drawTime })}
                />
                <NumberInput
                  label="Minimum price"
                  prefix="$"
                  min={0}
                  value={s.daily.minPrice}
                  onChange={(minPrice) => daily({ minPrice })}
                />
                <NumberInput
                  label="Maximum price"
                  prefix="$"
                  min={0}
                  value={s.daily.maxPrice}
                  onChange={(maxPrice) => daily({ maxPrice })}
                />
              </s-grid>
              <s-text type="strong">Products that can be picked</s-text>
              {sources.map((src, i) => (
                <RowCard
                  key={i}
                  heading={src.productType || `Source ${i + 1}`}
                  actions={
                    <s-button
                      variant="tertiary"
                      icon="delete"
                      accessibilityLabel="Remove"
                      onClick={() =>
                        daily({ sources: list.remove(sources, i) })
                      }
                    />
                  }
                >
                  <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                    <TextInput
                      label="Product type"
                      value={src.productType}
                      placeholder="Pokemon Sealed"
                      details="Exactly as it appears on the product in Shopify."
                      onChange={(productType) =>
                        daily({
                          sources: list.set(sources, i, { productType }),
                        })
                      }
                    />
                    <TextInput
                      label="Languages"
                      value={src.languages}
                      placeholder="Any language"
                      details='e.g. "English" (matches the Language_English tag). Blank allows any.'
                      onChange={(languages) =>
                        daily({ sources: list.set(sources, i, { languages }) })
                      }
                    />
                  </s-grid>
                </RowCard>
              ))}
              <s-stack direction="inline">
                <s-button
                  icon="plus"
                  onClick={() =>
                    daily({
                      sources: [...sources, { productType: "", languages: "" }],
                    })
                  }
                >
                  Add product type
                </s-button>
              </s-stack>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <NumberInput
                  label="Don't repeat a product for"
                  suffix="days"
                  min={0}
                  value={s.daily.noRepeatDays}
                  onChange={(noRepeatDays) => daily({ noRepeatDays })}
                />
                <NumberInput
                  label="A daily winner can win again after"
                  suffix="days"
                  min={0}
                  value={s.daily.winCooldownDays}
                  onChange={(winCooldownDays) => daily({ winCooldownDays })}
                />
              </s-grid>
              <Check
                label="Also Use Safety Stock"
                details="Automatic picks can use a product whose only stock is safety stock. Products you line up or choose yourself can always use it."
                checked={s.daily.useSafetyStock}
                onChange={(useSafetyStock) => daily({ useSafetyStock })}
              />
              <Select
                label="Daily Tasks Reset"
                details="When entrants can claim each Daily Task again. At the draw, each task counts once per daily drawing."
                value={s.dailyTasks.resetAt}
                options={[
                  { value: "draw", label: "At The Daily Draw" },
                  { value: "midnight", label: "Midnight Central Time" },
                ]}
                onChange={(resetAt) => set({ dailyTasks: { resetAt } })}
              />
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Winner email">
        <s-stack gap="base">
          <Check
            label="Email winners when they're drawn"
            checked={s.winnerEmail.enabled}
            onChange={(enabled) => winner({ enabled })}
          />
          {s.winnerEmail.enabled && (
            <>
              <TextInput
                label="Subject"
                value={s.winnerEmail.subject}
                onChange={(subject) => winner({ subject })}
              />
              <TextArea
                label="Message"
                rows={4}
                value={s.winnerEmail.body}
                details="Placeholders: {{prize}}, {{title}} and {{claim_url}} (the link where the winner confirms shipping)."
                onChange={(body) => winner({ body })}
              />
              <NumberInput
                label="Days to claim"
                min={1}
                value={s.winnerEmail.claimDays}
                details="After this the prize can be forfeited and redrawn."
                onChange={(claimDays) => winner({ claimDays })}
              />
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Consolation discount">
        <s-stack gap="base">
          <Check
            label="Send everyone who didn't win a discount code"
            checked={s.consolation.enabled}
            onChange={(enabled) => consolation({ enabled })}
          />
          {s.consolation.enabled && (
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <NumberInput
                label="Discount"
                suffix="%"
                min={1}
                max={100}
                value={s.consolation.percentOff}
                onChange={(percentOff) => consolation({ percentOff })}
              />
              <NumberInput
                label="Valid for"
                suffix="days"
                min={1}
                value={s.consolation.daysValid}
                onChange={(daysValid) => consolation({ daysValid })}
              />
              <NumberInput
                label="Minimum entries"
                min={0}
                value={s.consolation.minEntries}
                onChange={(minEntries) => consolation({ minEntries })}
              />
            </s-grid>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Integrations and display">
        <s-stack gap="base">
          <Check
            label="Add entrants to a Klaviyo list"
            checked={s.klaviyo.enabled}
            onChange={(enabled) => klaviyo({ enabled })}
          />
          {s.klaviyo.enabled && (
            <>
              <TextInput
                label="Klaviyo list ID"
                value={s.klaviyo.listId}
                placeholder="e.g. XyZ123"
                onChange={(listId) => klaviyo({ listId })}
              />
              <Check
                label="Only entrants who agreed to marketing"
                checked={s.klaviyo.onlyConsented}
                onChange={(onlyConsented) => klaviyo({ onlyConsented })}
              />
            </>
          )}
          <TextInput
            url
            label="Outbound webhook URL (optional)"
            placeholder="https://"
            details="Receives a POST for new entrants and winners."
            value={s.webhookUrl}
            onChange={(webhookUrl) => set({ webhookUrl })}
          />
          <Check
            label="Show a leaderboard on the giveaway"
            checked={s.showLeaderboard}
            onChange={(showLeaderboard) => set({ showLeaderboard })}
          />
          <Check
            label="Show winners after the draw"
            checked={s.showWinners}
            onChange={(showWinners) => set({ showWinners })}
          />
          <Check
            label="Require first and last name to enter"
            details={
              'So winners can be shown as "Emily S." People entered automatically from an order get the name on their order.'
            }
            checked={s.requireName}
            onChange={(requireName) => set({ requireName })}
          />
          <Check
            label="US residents only"
            details="Sign-up needs a ticked “I live in the US and have a US shipping address” box, winners must claim with an address in the 50 states or DC, and orders shipping outside the US earn no entries."
            checked={s.usOnly}
            onChange={(usOnly) => set({ usOnly })}
          />
          <Check
            label="Require the email opt-in to enter"
            details={
              'The "Email me deals" box must be ticked to sign up, and only people who ticked it are in the draw.'
            }
            checked={s.requireEmailConsent}
            onChange={(requireEmailConsent) => set({ requireEmailConsent })}
          />
          <TextInput
            label="Linked giveaway (link name)"
            placeholder="e.g. monthly-giveaway"
            details="One sign-up enters both giveaways. Texts, check-ins and follows of the same link count in both, and purchases already count in every live giveaway. Set it on either one."
            value={s.linkedSlug}
            onChange={(linkedSlug) => set({ linkedSlug })}
          />
        </s-stack>
      </s-section>
    </>
  );
}
