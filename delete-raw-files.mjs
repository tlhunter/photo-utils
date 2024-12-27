#!/usr/bin/env zx

/**
 * `npm install -g zx`
 *
 * I take photos on a Sony camera in RAW+JPG mode.
 * I then scroll through all the photos in Darktable usually at least once.
 * When I really like a photo I export it as DSC001.export.jpg or DSC001.insta.jpg.
 * Sometimes I rate photos in Darktable but not always.
 *
 * At this point a directory contains a bunch of files named like this:
 * DSC001.JPG
 * DSC001.ARW
 * DSC001.ARW.xmp
 * DSC001.JPG.xmp (TODO presence of these files leave the ARW.xmp file ignored)
 * DSC001.export.jpg
 * DSC001.insta.jpg
 *
 * So to know if a file is worth keeping it will have a DSC001.*.jpg file.
 * Or, the DSC001.ARW.xmp file will have some sort of rating metadata.
 *
 * This script deletes *.ARW and *.ARW.xmp files deemed as not worth keeping.
 */

// Minimal rating to keep a photo. 1 means keep everything, 5 means keep perfect, etc
const MIN_RATING = Number(argv['rating']);
// pass --delete to actually delete files, otherwise they're just logged
const DELETE = argv['delete'];
// which directory to examine
const DIR = argv['dir'] || process.cwd();
// default extension (TODO: make this work for any format)
const RAW_EXT = '.' + (argv['ext'] || 'ARW').toLowerCase();
// files exceeding this edit count won't be deleted
const MAX_EDITS = Number(argv['max-edits']) || Infinity
// by default a raw file w/o a JPG is preserved. e.g. guarantees some version of file exists. pass flag to ignore missing jpg
const IGNORE_JPG = !!argv['ignore-jpg'];

const files_array = await fs.readdir(DIR);

const files_all_casings = new Set(files_array);
for (let file of files_array) {
  files_all_casings.add(file.toLowerCase());
}

const prefixes = [];
const prefix_to_real_filenames = new Map();
for (let file of files_array) {
  const normalized = file.toLowerCase(); // dsc001.arw
  const prefix = file.split('.')[0]; // DSC001
  if (path.extname(normalized) === RAW_EXT) {
    prefixes.push(prefix);
    prefix_to_real_filenames.set(prefix, { // DSC001
      prefix,
      filename: file, // DSC001.ARW
      darktable: null, // DSC001.ARW.xmp
      export: null, // DSC001.*.jpg
      jpg: null, // DSC001.jpg
      rating: 0, // 1 - 5
      mods: 0, // number of Darktable modifications, min seems to be 11
    });
  }
}

for (let file of files_array) {
  const normalized = file.toLowerCase(); // dsc001.arw
  if (path.extname(normalized) === RAW_EXT) continue; // looking at raw again

  const prefix = file.split('.')[0]; // DSC001
  const prefix_obj = prefix_to_real_filenames.get(prefix);
  if (!prefix_obj) continue;

  if (normalized.match(/^.+\..+\.jpg$/)) {
    prefix_obj.export = file;
  } else if (path.extname(normalized) === '.xmp') { // TODO: this picks up jpg.xmp
    prefix_obj.darktable = file;
    const rating = await getRatingFromDarktableFile(file);
    prefix_obj.rating = rating;
    const mod_count = await getNumberOfModifications(file);
    prefix_obj.mods = mod_count;
  } else if (normalized === `${prefix.toLowerCase()}.jpg`) {
    prefix_obj.jpg = file;
  }
}

for (const photo of prefix_to_real_filenames.values()) {
  if (!IGNORE_JPG && !photo.jpg) {
    console.warn(chalk.blue(`${photo.filename}: KEEP: NO MATCH JPG`));
    continue;
  }

  if (photo.rating >= MIN_RATING) {
    console.warn(chalk.blue(`${photo.filename}: KEEP: ${getRating(photo)}`));
    continue;
  }

  if (photo.export) {
    console.warn(chalk.blue(`${photo.filename}: KEEP: HAS EXPORT ${photo.export}`));
    continue;
  }

  if (photo.mods >= MAX_EDITS) {
    console.warn(chalk.blue(`${photo.filename}: KEEP: HAS ${photo.mods} EDITS`));
    continue;
  }

  if (DELETE) {
    await sendToTrash(photo.filename);
    await sendToTrash(photo.darktable);
    if (photo.rating < 0) { // -1 means rejected. it sucks so much we delete the JPG
      // TODO: This should run regardless of prior checks
      if (photo.jpg) await sendToTrash(photo.jpg);
    }
  } else {
    console.log(chalk.yellow(`${photo.filename}: WOULD DELETE, ${getRating(photo)}`));
  }
}

async function sendToTrash(filename) {
  console.log(chalk.red(`${filename}: DELETE`));
  await $`gio trash ${filename}`
}

async function getRatingFromDarktableFile(darktable_filename) {
  const content = (await fs.readFile(darktable_filename)).toString();
  const match = content.match(/xmp:Rating="([-0-9]+)"/);

  if (!match) return 0;

  return Number(match[1]);
}

async function getNumberOfModifications(darktable_filename) {
  const content = (await fs.readFile(darktable_filename)).toString();
  const match = content.match(/<rdf:li/g);

  if (!match) return 0;

  return match.length;
}

function getRating(photo) {
  if (photo.rating < 0) {
    return "MARKED AS REJECT";
  }

  return `RATING ${photo.rating}/5`;
}
