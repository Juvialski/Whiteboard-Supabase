# Historical asset-upload repair

This repair is already included in the ordered migration history and generated
`supabase-schema.sql`. The current production project has already applied it.

**Do not rerun this file merely because of a frontend/build error.** A brand-new
project receives the policy through the root schema. Current uploads use real
MIME types, 20 MB client/bucket limits, PNG blank PDF pages, file-signature
validation, and contextual errors.
