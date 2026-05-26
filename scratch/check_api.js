async function test() {
  const url = "https://pronounce-helper.vercel.app/api/sentences?word=test";
  console.log("Fetching:", url);
  try {
    const res = await fetch(url);
    console.log("Status:", res.status);
    console.log("Headers:");
    for (const [key, value] of res.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    const text = await res.text();
    console.log("Body length:", text.length);
    console.log("Body snippet:", text.substring(0, 500));
  } catch (err) {
    console.error("Fetch error:", err);
  }
}
test();
