-- Delete benchmark rows affected by the coding=0 bug.
--
-- These 32 rows were run with a bug that set all coding scores to 0/35.
-- They have since been re-run with the fix applied.
-- All affected rows are from 2026-03-01 to 2026-03-02 with coding.correct = 0.

DELETE FROM public.benchmarks
WHERE id IN (
  '8b1199c8-176e-4430-95c5-d6352462efaf',
  '8fec95bc-729f-4455-b7a4-34114409623a',
  'cfc698a4-cee3-458a-b81e-b401fe02d68d',
  '48c17182-744b-4e49-832c-037a88f8437a',
  'bee0978a-c064-4972-9194-e10df626bb65',
  '8413e0bc-6a75-4077-87a9-c17ab8cf657b',
  'ce5d1088-a52f-4066-8935-c1d33b02f49d',
  '44a4f9b6-0ad6-4ec3-8ade-07021baf601d',
  '7c241d39-c4c6-44f6-8e64-a0401377a0cf',
  '0c7a9256-ed26-462d-8fab-06927b2bbc6e',
  'c75c7b64-e6a1-4883-b011-25859edc0a9f',
  '367e1430-2959-41b1-81ef-3c3f5770c11b',
  '1b9ecdb0-d855-4707-bcc3-3ce347913be2',
  '017e6e55-bab0-4122-9b8e-0288c06ee1fc',
  'ea29304c-e3b1-4201-b39e-a684593dcc80',
  'c07bc3b7-5db6-4872-921a-cabc52b4faf4',
  '537719ea-35a3-4523-b46c-35f383bc1ce8',
  '4460a8e5-bdb4-46d7-81ad-6d9bc3d66ec1',
  'e34d119b-cf68-4ed1-8b65-9bb3666058a2',
  '05245259-0004-4952-ba4d-4d698d38cc5d',
  '57727719-68f6-4e21-bf43-0aaec166a2f0',
  'b5fca53f-5913-4e84-99e2-1ca2ad94e99f',
  '9e47ac2b-2391-43b9-baa4-7a9dc5e3f86f',
  '2bc57c5e-b87f-47b1-95c6-0a7e16cda436',
  '08887c6b-be90-42a8-b26f-6b3f647089e3',
  '8f1917ed-0302-440c-842c-001b86f1d551',
  '697b2aa3-281b-427b-993c-924077f15cbb',
  '4973c85f-f12b-49db-8628-a1f74778d44a',
  '8974b117-6ed7-4560-96ae-c483dff5dea1',
  '08df6f7a-164b-4801-b7f9-c8fe981aa25c',
  'e549607f-08fa-41d6-9f4d-c1435713f068',
  '39a98c8b-3863-4c40-8c52-5fcdb9b60eb4'
);
