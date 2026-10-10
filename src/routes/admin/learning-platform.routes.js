const { validateRequest } = require('../../middlewares/validation.middleware');
const c = require('../../contracts/learning-platform.contract');
const { learningPlatform } = require('../../services/learning-platform.service');

const handle = (work) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerLearningPlatformRoutes(router, service = learningPlatform) {
  router.get(
    '/admin/api/learning/me',
    handle((req) => service.me(req.admin)),
  );
  router.get(
    '/admin/api/learning/catalog',
    handle((req) => service.catalog(req.admin)),
  );
  router.get(
    '/admin/api/learning/courses/:id',
    validateRequest({ params: c.idParams }),
    handle((req) => service.course(req.admin, req.params.id)),
  );
  router.post(
    '/admin/api/learning/lessons/:id/progress',
    validateRequest({ params: c.idParams, body: c.completeLesson }),
    handle((req) => service.completeLesson(req.admin, req.params.id)),
  );
  router.post(
    '/admin/api/learning/assessments/:id/attempts',
    validateRequest({ params: c.idParams, body: c.empty }),
    handle((req) => service.startAttempt(req.admin, req.params.id)),
  );
  router.get(
    '/admin/api/learning/attempts/:id',
    validateRequest({ params: c.idParams }),
    handle((req) => service.attempt(req.admin, req.params.id)),
  );
  router.post(
    '/admin/api/learning/attempts/:id/submit',
    validateRequest({ params: c.idParams, body: c.submitAttempt }),
    handle((req) => service.submitAttempt(req.admin, req.params.id, req.body)),
  );

  router.get(
    '/admin/api/learning/manage/dashboard',
    handle((req) => service.dashboard(req.admin)),
  );
  router.get(
    '/admin/api/learning/manage/roles',
    handle((req) => service.roles(req.admin)),
  );
  router.post(
    '/admin/api/learning/manage/roles',
    validateRequest({ body: c.roleCreate }),
    handle((req) => service.saveRole(req.admin, null, req.body)),
  );
  router.patch(
    '/admin/api/learning/manage/roles/:id',
    validateRequest({ params: c.idParams, body: c.rolePatch }),
    handle((req) => service.saveRole(req.admin, req.params.id, req.body)),
  );
  router.get(
    '/admin/api/learning/manage/courses',
    handle((req) => service.courses(req.admin)),
  );
  router.post(
    '/admin/api/learning/manage/courses',
    validateRequest({ body: c.courseCreate }),
    handle((req) => service.saveCourse(req.admin, null, req.body)),
  );
  router.patch(
    '/admin/api/learning/manage/courses/:id',
    validateRequest({ params: c.idParams, body: c.coursePatch }),
    handle((req) => service.saveCourse(req.admin, req.params.id, req.body)),
  );
  router.get(
    '/admin/api/learning/manage/assessments',
    handle((req) => service.assessments(req.admin)),
  );
  router.post(
    '/admin/api/learning/manage/assessments',
    validateRequest({ body: c.assessmentCreate }),
    handle((req) => service.saveAssessment(req.admin, null, req.body)),
  );
  router.patch(
    '/admin/api/learning/manage/assessments/:id',
    validateRequest({ params: c.idParams, body: c.assessmentPatch }),
    handle((req) => service.saveAssessment(req.admin, req.params.id, req.body)),
  );
  router.get(
    '/admin/api/learning/manage/employees',
    handle((req) => service.employees(req.admin)),
  );
  router.patch(
    '/admin/api/learning/manage/employees/:username',
    validateRequest({ params: c.usernameParams, body: c.employeePatch }),
    handle((req) => service.patchEmployee(req.admin, req.params.username, req.body)),
  );
  router.get(
    '/admin/api/learning/manage/assignments',
    handle((req) => service.assignments(req.admin)),
  );
  router.post(
    '/admin/api/learning/manage/assignments',
    validateRequest({ body: c.assignmentCreate }),
    handle((req) => service.createAssignment(req.admin, req.body)),
  );
  router.delete(
    '/admin/api/learning/manage/assignments/:id',
    validateRequest({ params: c.idParams, body: c.empty }),
    handle((req) => service.deleteAssignment(req.admin, req.params.id)),
  );
  router.get(
    '/admin/api/learning/manage/results',
    handle((req) => service.results(req.admin)),
  );
  router.post(
    '/admin/api/learning/manage/attempts/:id/promotion-decision',
    validateRequest({ params: c.idParams, body: c.promotionDecision }),
    handle((req) => service.promotionDecision(req.admin, req.params.id, req.body)),
  );
}

module.exports = { registerLearningPlatformRoutes };
