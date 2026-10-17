-- "Well received" is delivery-context language, not generic chatter.

delete from public.sellertray_intent_vocab
where intent='general_chatter'
  and phrase='well received'
  and match_mode='exact'
  and locale='en-NG';

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values ('delivery_confirm','well received','exact',0.94,25)
on conflict do nothing;
