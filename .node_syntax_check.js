(async () => {
  try {
    console.log('Checking imports for videoProcessor and instagramService...');
    await import('./utils/videoProcessor.js');
    await import('./services/instagramService.js');
    console.log('Imports succeeded.');
    process.exit(0);
  } catch (e) {
    console.error('Import error:', e);
    process.exit(2);
  }
})();
