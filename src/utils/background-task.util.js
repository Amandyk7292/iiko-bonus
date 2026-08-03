const activeTasks = new Set();

function runBackgroundTask(label, task) {
  const name = String(label || 'background task');
  const promise = new Promise((resolve) => setImmediate(resolve))
    .then(task)
    .catch((error) => {
      console.error(`${name} failed:`, error?.message || error);
    })
    .finally(() => activeTasks.delete(promise));
  activeTasks.add(promise);
  return promise;
}

async function waitForBackgroundTasks() {
  await Promise.allSettled([...activeTasks]);
}

module.exports = { runBackgroundTask, waitForBackgroundTasks };
