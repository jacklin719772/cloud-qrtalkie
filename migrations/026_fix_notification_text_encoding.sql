UPDATE notification_events
SET title = CONVERT(UNHEX('e8afb7e8b4ade4b9b0e5a597e9a490') USING utf8mb4),
    body = CONVERT(UNHEX('e5bd93e5898de8b4a6e58fb7e5b09ae69caae8aea2e8b4ade4bbbbe4bd95e5a597e9a490efbc8ce8afb7e59ca8e2809ce68891e79a84e5a597e9a490e2809de4b8ade8b4ade4b9b0e5a597e9a490e38082') USING utf8mb4)
WHERE event_type = 'no_plan_purchased';

UPDATE notification_events
SET title = CONVERT(UNHEX('e8aea2e58d95e5be85e694afe4bb98') USING utf8mb4),
    body = CONCAT(
      CONVERT(UNHEX('e8aea2e58d9520') USING utf8mb4),
      COALESCE(scope_id, id),
      CONVERT(UNHEX('20e5b09ae69caae5ae8ce68890e694afe4bb98efbc8ce8afb7e59ca8e2809ce68891e79a84e5a597e9a490e2809de4b8ade5a484e79086e38082') USING utf8mb4)
    )
WHERE event_type = 'payment_required';

UPDATE notification_events
SET title = CONVERT(UNHEX('e8aea2e58d95e5be85e68f90e4baa4e5aea1e6a0b8') USING utf8mb4),
    body = CONCAT(
      CONVERT(UNHEX('e8aea2e58d9520') USING utf8mb4),
      COALESCE(scope_id, id),
      CONVERT(UNHEX('20e5b7b2e5ae8ce68890e694afe4bb98efbc8ce4bd86e5b09ae69caae68f90e4baa4e5aea1e6a0b8efbc8ce8afb7e59ca8e2809ce68891e79a84e5a597e9a490e2809de4b8ade5a484e79086e38082') USING utf8mb4)
    )
WHERE event_type = 'review_submission_required';

UPDATE notification_events e
JOIN billing_orders o ON o.id = e.scope_id
SET e.body = CONCAT(
  CONVERT(UNHEX('e8aea2e58d9520') USING utf8mb4),
  COALESCE(o.order_no, e.scope_id),
  CONVERT(UNHEX('20e5b09ae69caae5ae8ce68890e694afe4bb98efbc8ce8afb7e59ca8e2809ce68891e79a84e5a597e9a490e2809de4b8ade5a484e79086e38082') USING utf8mb4)
)
WHERE e.event_type = 'payment_required';

UPDATE notification_events e
JOIN billing_orders o ON o.id = e.scope_id
SET e.body = CONCAT(
  CONVERT(UNHEX('e8aea2e58d9520') USING utf8mb4),
  COALESCE(o.order_no, e.scope_id),
  CONVERT(UNHEX('20e5b7b2e5ae8ce68890e694afe4bb98efbc8ce4bd86e5b09ae69caae68f90e4baa4e5aea1e6a0b8efbc8ce8afb7e59ca8e2809ce68891e79a84e5a597e9a490e2809de4b8ade5a484e79086e38082') USING utf8mb4)
)
WHERE e.event_type = 'review_submission_required';
