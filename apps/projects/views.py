from django.views.generic import ListView, DetailView

from .models import Project


class ProjectViewBase(object):
    model = Project


class ProjectListView(ProjectViewBase, ListView):
    pass


class ProjectDetailView(ProjectViewBase, DetailView):
    pass
