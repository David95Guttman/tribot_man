const fs = require('fs');
const text = fs.readFileSync('1.txt', {encoding:'utf-8'});
const mainContent = text.split(/\s+/)[1];
console.log(mainContent);