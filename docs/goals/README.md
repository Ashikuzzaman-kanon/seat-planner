# Goal study pages

Study material for the goal sub-topics still open, written to learn from first and present from after.
Every sub-goal at 100% is left out. The learning-goal topics in [`docs/LEARNING-GOALS.md`](../LEARNING-GOALS.md)
are unchanged; its goal sheet now points here for each open sub-goal.

**All the theory in one document:** [theory.md](theory.md) has pages 1 to 8 below in study order, with one
contents table and a revision sheet (every sub-topic in one sentence) at the end. It is built from these
pages by `node tools/build-theory-guide.js`, so edit a page and run that; never edit theory.md itself.

**For the demo itself:** [demo-cheatsheet.md](demo-cheatsheet.md) keeps only each topic's purpose, the points
to make and the commands to show, all on one page.

## How each sub-topic is laid out

Every sub-topic follows the same nine parts, so you always know where to look:

1. **In one sentence:** the whole idea, short enough to open with.
2. **Why it matters:** what goes wrong without it.
3. **Key ideas:** the terms you need, in plain words.
4. **Try it yourself:** safe commands to run on your own machine (Docker is already set up), so the
   theory sticks. Nothing here changes production; a few read-only checks look at the live site.
5. **In this project:** where Seat Planner already does it, with the files to open.
6. **At larger scale:** what bigger teams use instead or as well.
7. **Common mistakes:** the usual traps, and how to avoid them.
8. **Explain it in two minutes:** a short talk to give in the demo.
9. **Questions you may be asked:** with answers.

The debugging page is different: it is a **runbook** for a live demo. Set-up first, then for each technique
the steps to click through, what to say, and what to do if something does not behave, with ready-made run
configurations (`.run/`) and small scripts (`demo/debugging/`).

## What to study, in order

| # | Page | Sub-goals | Demo |
|---|---|---|---|
| 1 | [Docker basics](deployment-basic.md) | Docker - Basic Commands · Networking · Debugging and Logs | Theory |
| 2 | [Docker, advanced](docker-advanced.md) | Docker - Optimizing Images · Security · Resource Management · Custom Registries | Theory |
| 3 | [Security in deployment](deployment-security.md) | Security in Application Deployment | Theory |
| 4 | [Monitoring and logging](deployment-monitoring-logging.md) | Monitoring and Logging | Theory |
| 5 | [Rollback and disaster recovery](deployment-rollback-dr.md) | Rollback and Disaster Recovery | Theory |
| 6 | [Best practices](deployment-best-practices.md) | Best Practices for Application Deployment | Theory |
| 7 | [Jenkins](jenkins.md) | Jenkins - Basics · Freestyle Project · Pipeline Project · Configuration | Theory |
| 8 | [AI productivity](ai-productivity.md) | All six sub-goals of *Multiply productivity using AI* | Summary; judged on everyday work |
| 9 | [Debugging demo](debugging-demo.md) | All seven of *Debugging Techniques (Advanced)* | **Live, in IntelliJ IDEA / PhpStorm** |

The order builds up: Docker first (everything else runs on it), then the operational topics that
use it, then Jenkins (which ties build, test and deploy together). The debugging demo is last, as
agreed.

## Presenting a theory topic

- Open with the **one sentence**, then the **why**: people remember the problem better than the term.
- Use **this project** as your example wherever you can. It is real, it runs, and you know it.
- Say plainly what this project does **not** do yet, and what you would add. It sounds honest, and it
  shows you understand the topic, not just the tool.
- Keep the **Try it yourself** commands in your pocket: if asked "how would you check that?", you can
  answer with the command.
