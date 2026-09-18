// Quick debug: Test buildBrushOutline with simple cases
const { buildBrushOutline } = require('./EditorFuentes.tsx');

console.log('=== Testing brush outline ===');

// Test 1: Single point (should create a cap)
console.log('\nTest 1: Single point {x: 100, y: 100}');
const singleResult = buildBrushOutline([{x: 100, y: 100}], 12, 'round');
console.log(`Result: ${singleResult.length} points`);
for (let i = 0; i < Math.min(singleResult.length, 5); i++) {
  console.log(`  ${i}: (${singleResult[i].x}, ${singleResult[i].y})`);
}

// Test 2: Two points (simple line)
console.log('\nTest 2: Two points forming line');
const twoResult = buildBrushOutline([{x: 100, y: 100}, {x: 200, y: 100}], 12, 'round');
console.log(`Result: ${twoResult.length} points`);

// Test 3: Three points (with turn)
console.log('\nTest 3: Three points with turn');
const threeResult = buildBrushOutline([
  {x: 100, y: 100}, 
  {x: 150, y: 50}, 
  {x: 200, y: 100}
], 12, 'round');
console.log(`Result: ${threeResult.length} points`);

// Print all points
for (let i = 0; i < threeResult.length; i++) {
  console.log(`  ${i}: (${threeResult[i].x}, ${threeResult[i].y})`);
}